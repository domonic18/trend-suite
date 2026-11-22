import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { listAssets } from './service'
import { deleteStage, rerunStage } from './stages'

/**
 * 素材三段的数据库行为（教师端需求 T4b）：
 * - 全局素材库跨课程返回，素材带归属课程与三段状态；
 * - 删一段只删那一段的产物；
 * - 理解结果被方案引用时不可清空（课程内容会悬空）。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

async function seedAsset(input: {
  courseId: string
  fileName: string
  withSegments?: boolean
  withFrames?: boolean
  withUnits?: boolean
}): Promise<string> {
  const id = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, video_ok, audio_ok)
     VALUES ($1, $2, $3, $4, 'uploaded', true, true)`,
    [id, input.courseId, input.fileName, `sources/${id}/source`],
  )
  if (input.withSegments) {
    await query(
      `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
       VALUES ($1, $2, 0, 0, 5000, '逐字稿一段', false)`,
      [newId('transcriptSegment'), id],
    )
  }
  if (input.withFrames) {
    await query(
      `INSERT INTO media_frames (id, asset_id, at_ms, path) VALUES ($1, $2, 1000, $3)`,
      [newId('mediaFrame'), id, `sources/${id}/frames/f1.jpg`],
    )
  }
  if (input.withUnits) {
    await query(
      `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra)
       VALUES ($1, $2, $3, 0, 5000, '理解单元', '{"teachingPoints":["要点一"]}')`,
      [newId('sourceUnit'), input.courseId, id],
    )
  }
  return id
}

before(async () => {
  if (url) await resetTestDatabase()
})

test('全局素材库：跨课程返回，素材带归属课程与三段状态', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-lib',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  const courseA = await createCourse(teacher.id, '趋势总论')
  const courseB = await createCourse(teacher.id, '级别与周期')

  await seedAsset({ courseId: courseA.id, fileName: '总论.mp4', withSegments: true, withFrames: true, withUnits: true })
  await seedAsset({ courseId: courseB.id, fileName: '周期.mp4' })

  const all = await listAssets(user)
  assert.equal(all.length, 2)
  const first = all.find((item) => item.fileName === '总论.mp4')
  assert.ok(first)
  assert.equal(first.courseTitle, '趋势总论')
  assert.equal(first.stages.length, 3)
  assert.deepEqual(
    first.stages.map((stage) => stage.stage),
    ['transcript', 'frames', 'understanding'],
  )
  assert.equal(first.stages.find((s) => s.stage === 'transcript')?.status, 'done')
  assert.equal(first.stages.find((s) => s.stage === 'transcript')?.count, 1)
  assert.equal(first.stages.find((s) => s.stage === 'understanding')?.count, 1)

  const second = all.find((item) => item.fileName === '周期.mp4')
  assert.equal(second?.courseTitle, '级别与周期')
  assert.equal(second?.stages.find((s) => s.stage === 'frames')?.status, 'empty')

  // 按课程过滤只回本课的
  const scoped = await listAssets(user, courseB.id)
  assert.equal(scoped.length, 1)
  assert.equal(scoped[0]?.fileName, '周期.mp4')
})

test('重跑某段只入队该段任务，段状态记为进行中', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-rerun',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  const course = await createCourse(teacher.id, '重跑课')
  const assetId = await seedAsset({ courseId: course.id, fileName: 'r.mp4', withSegments: true })

  const result = await rerunStage(user, assetId, 'transcript', false)
  assert.ok(result.jobId)

  const jobs = await query<{ kind: string; stage: string | null; status: string }>(
    `SELECT kind, stage, status FROM pipeline_jobs WHERE asset_id = $1`,
    [assetId],
  )
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0]?.kind, 'media_stage')
  assert.equal(jobs[0]?.stage, 'transcript')
  assert.equal(jobs[0]?.status, 'queued')
})

test('重跑理解要有逐字稿：没有逐字稿时拒绝', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-noprereq',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  const course = await createCourse(teacher.id, '前提课')
  const assetId = await seedAsset({ courseId: course.id, fileName: 'n.mp4' })

  await assert.rejects(
    () => rerunStage(user, assetId, 'understanding', false),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 409)
      assert.match(String(err.message), /逐字稿/)
      return true
    },
  )
})

test('删除逐字稿结果：只删逐字稿，关键帧与理解不动', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-delstage',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  const course = await createCourse(teacher.id, '删段课')
  const assetId = await seedAsset({
    courseId: course.id,
    fileName: 'd.mp4',
    withSegments: true,
    withFrames: true,
    withUnits: true,
  })

  await deleteStage(user, assetId, 'transcript')

  const segments = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM transcript_segments WHERE asset_id = $1`,
    [assetId],
  )
  const frames = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM media_frames WHERE asset_id = $1`,
    [assetId],
  )
  const units = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_units WHERE asset_id = $1`,
    [assetId],
  )
  assert.equal(segments[0]?.n, '0')
  assert.equal(frames[0]?.n, '1')
  assert.equal(units[0]?.n, '1')
})

test('理解结果被课程方案引用时不可清空（409 material_referenced）', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-ref',
    password: 'correct-horse',
    role: 'producer',
  })
  const user = { ...teacher, displayName: teacher.displayName }
  const course = await createCourse(teacher.id, '引用课')
  const assetId = await seedAsset({
    courseId: course.id,
    fileName: 'ref.mp4',
    withSegments: true,
    withUnits: true,
  })
  const units = await query<{ id: string }>(
    `SELECT id FROM source_units WHERE asset_id = $1`,
    [assetId],
  )
  const unitId = units[0]!.id

  await query(
    `INSERT INTO course_plans (id, course_id, version, status, skeleton, concept_map, glossary, section_plan, created_by)
     VALUES ($1, $2, 1, 'approved', $3::jsonb, '{}'::jsonb, '{}'::jsonb, '{"lessons":[]}'::jsonb, $4)`,
    [
      newId('plan'),
      course.id,
      JSON.stringify({ nodes: [{ id: 'n1', title: '第一课', sourceUnitIds: [unitId] }] }),
      teacher.id,
    ],
  )

  await assert.rejects(
    () => deleteStage(user, assetId, 'understanding'),
    (err: { status?: number; code?: string }) => {
      assert.equal(err.status, 409)
      assert.equal(err.code, 'material_referenced')
      return true
    },
  )

  const left = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_units WHERE asset_id = $1`,
    [assetId],
  )
  assert.equal(left[0]?.n, '1')
})
