import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import * as jobRepo from '../jobs/repo'
import * as repo from '../repo'
import { createAsset, deleteMaterial, listAssets } from '../service'
import { cancelMaterialProcessing, ingestAsset, retryAsset } from './service'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

const mediaDir = mkdtempSync(join(tmpdir(), 'trend-govern-'))
process.env.MEDIA_STORAGE = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_UPLOAD_SECRET = 'test-upload-secret-0123456789'

before(async () => {
  if (url) await resetTestDatabase()
})

/** 建一个「已上传」素材（绕过直传与 ffprobe，治理用例只关心行与队列）。 */
async function uploadedAsset(username: string, courseName: string, fileName: string) {
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, courseName)
  const user = { ...teacher, displayName: teacher.displayName }
  const created = await createAsset(user, { courseId: course.id, fileName, byteSize: 1024 })
  await repo.markUploaded(created.asset.id, {
    byteSize: 1024,
    sha256: 'a'.repeat(64),
    durationS: 60,
    videoOk: true,
    audioOk: true,
    sourcePath: `sources/${created.asset.id}/source`,
  })
  return { user, course, assetId: created.asset.id }
}

test('排队中停止：任务直接取消，素材回「已上传」', { skip }, async () => {
  const { user, assetId } = await uploadedAsset('caoshi-stopq', '停止排队课', '排队.mp4')
  const { jobId } = await ingestAsset(user, assetId)

  const result = await cancelMaterialProcessing(user, assetId)
  assert.equal(result.asset.jobStatus, 'canceled')
  assert.equal(result.asset.status, 'uploaded')
  assert.equal(result.asset.processMessage, '已停止')

  const job = await jobRepo.findJobByAsset({ assetId, kind: 'ingest' })
  assert.equal(job?.id, jobId)
  assert.equal(job?.status, 'canceled')

  // 没有进行中任务再点停止 → 409 material_not_processing
  await assert.rejects(
    () => cancelMaterialProcessing(user, assetId),
    (err: { status?: number; code?: string }) => {
      assert.equal(err.status, 409)
      assert.equal(err.code, 'material_not_processing')
      return true
    },
  )
})

test('运行中停止：置取消标记等阶段边界，素材提示正在停止', { skip }, async () => {
  const { user, assetId } = await uploadedAsset('caoshi-stopr', '停止运行课', '运行.mp4')
  await ingestAsset(user, assetId)
  const claimed = await jobRepo.claimJob('worker-stop')
  assert.equal(claimed?.asset_id, assetId)
  assert.equal(claimed?.status, 'running')

  const result = await cancelMaterialProcessing(user, assetId)
  assert.equal(result.asset.jobStatus, 'running')
  assert.equal(result.asset.processMessage, '正在停止…')
  assert.ok(await jobRepo.isCancelRequested(claimed!.id))
})

test('停止后可重新加工：已转产物保留，不报冲突', { skip }, async () => {
  const { user, assetId } = await uploadedAsset('caoshi-reing', '停止重跑课', '重跑.mp4')
  await ingestAsset(user, assetId)
  await cancelMaterialProcessing(user, assetId)

  const retried = await retryAsset(user, assetId)
  assert.equal(retried.asset.jobStatus, 'queued')
})

test('删除素材：行、任务、关键帧与已落盘字节一并清理', { skip }, async () => {
  const { user, course, assetId } = await uploadedAsset('caoshi-del', '删除课', '删除.mp4')
  await ingestAsset(user, assetId)
  const sourceFile = join(mediaDir, 'sources', assetId, 'source')
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path, width, height)
     VALUES ($1, $2, 0, 'x.jpg', 16, 9)`,
    [`mf_${assetId}`, assetId],
  )

  await deleteMaterial(user, assetId)

  assert.equal(await repo.findAssetById(assetId), null)
  assert.equal(await jobRepo.findJobByAsset({ assetId, kind: 'ingest' }), null)
  const frames = await query<{ id: string }>(`SELECT id FROM media_frames WHERE asset_id = $1`, [assetId])
  assert.equal(frames.length, 0)
  assert.equal((await listAssets(user, course.id)).length, 0)
})

test('删除不存在的素材 → 404', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-del404',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  await assert.rejects(
    () => deleteMaterial(user, 'mas_nonexistent'),
    (err: { status?: number }) => {
      assert.equal(err.status, 404)
      return true
    },
  )
})

test('已产出理解成果的素材删除被拒（409 material_referenced）', { skip }, async () => {
  const { user, course, assetId } = await uploadedAsset('caoshi-ref', '引用课', '引用.mp4')
  // 真实 source_units 表（迁移 011）——不再是临时建的影子表。
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text)
     VALUES ($1, $2, $3, 0, 1000, 'x')`,
    ['su_ref_1', course.id, assetId],
  )
  await assert.rejects(
    () => deleteMaterial(user, assetId),
    (err: { status?: number; code?: string }) => {
      assert.equal(err.status, 409)
      assert.equal(err.code, 'material_referenced')
      return true
    },
  )
  assert.ok(await repo.findAssetById(assetId))
})
