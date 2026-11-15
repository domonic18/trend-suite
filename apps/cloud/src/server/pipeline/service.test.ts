import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { createAsset, listAssets, receiveUpload } from './service'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

const mediaDir = mkdtempSync(join(tmpdir(), 'trend-media-'))
process.env.MEDIA_STORAGE = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_UPLOAD_SECRET = 'test-upload-secret-0123456789'

/** 夹具用 ffmpeg 现场转出（CI 的 test job 已装 ffmpeg）；没有 ffmpeg 就跳过媒体校验用例。 */
function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function makeFixture(withAudio: boolean): Buffer {
  const path = join(mediaDir, withAudio ? 'with-audio.mp4' : 'no-audio.mp4')
  if (withAudio) {
    execFileSync('ffmpeg', [
      '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
      '-shortest', '-c:v', 'libx264', '-c:a', 'aac',
      path,
    ])
  } else {
    execFileSync('ffmpeg', [
      '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:d=1',
      '-c:v', 'libx264', '-an',
      path,
    ])
  }
  return readFileSync(path)
}

function uploadRequest(assetId: string, headers: Record<string, string>, bytes: Buffer): Request {
  const body = Readable.toWeb(Readable.from([bytes]))
  return new Request(`http://localhost/v1/admin/content/media-assets/${assetId}/upload`, {
    method: 'PUT',
    body: body as BodyInit,
    duplex: 'half',
    headers,
  } as RequestInit)
}

before(async () => {
  if (url) await resetTestDatabase()
})

test('同课程同名同大小再建素材，复用同一条（重试不产生重复素材）', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-upload',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '上传课')
  const user = { ...teacher, displayName: teacher.displayName }

  const first = await createAsset(user, {
    courseId: course.id,
    fileName: '总论-01.mp4',
    byteSize: 1024,
  })
  const second = await createAsset(user, {
    courseId: course.id,
    fileName: '总论-01.mp4',
    byteSize: 1024,
  })

  assert.equal(first.asset.id, second.asset.id)
  assert.equal(first.asset.status, 'awaiting_upload')
  assert.equal(first.upload.method, 'PUT')
  assert.ok(first.upload.headers['x-upload-token'])

  const items = await listAssets(user, course.id)
  assert.equal(items.length, 1)
})

test('直传完成：素材变已上传，摘要与时长入库', { skip: skip || (hasFfmpeg() ? false : '缺少 ffmpeg') }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-upok',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '直传课')
  const user = { ...teacher, displayName: teacher.displayName }
  const bytes = makeFixture(true)

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: '录像.mp4',
    byteSize: bytes.length,
  })
  const asset = await receiveUpload(
    user,
    created.asset.id,
    uploadRequest(created.asset.id, created.upload.headers, bytes),
  )

  assert.equal(asset.status, 'uploaded')
  assert.equal(asset.byteSize, bytes.length)
  assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.ok(asset.videoOk)
  assert.ok(asset.audioOk)
  assert.ok(asset.durationS !== null && asset.durationS > 0)

  const items = await listAssets(user, course.id)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.status, 'uploaded')
})

test('无音轨文件被拒，且列表里不留半成品', { skip: skip || (hasFfmpeg() ? false : '缺少 ffmpeg') }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-noaudio',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '无音轨课')
  const user = { ...teacher, displayName: teacher.displayName }
  const bytes = makeFixture(false)

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: '无声.mp4',
    byteSize: bytes.length,
  })

  await assert.rejects(
    () => receiveUpload(user, created.asset.id, uploadRequest(created.asset.id, created.upload.headers, bytes)),
    (err: { status?: number; code?: string }) => {
      assert.equal(err.status, 422)
      assert.equal(err.code, 'unprocessable_media')
      return true
    },
  )

  const items = await listAssets(user, course.id)
  assert.equal(items.length, 0)
})

test('直传凭据不匹配被拒', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-token',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '凭据课')
  const user = { ...teacher, displayName: teacher.displayName }

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: 'x.mp4',
    byteSize: 16,
  })

  await assert.rejects(
    () =>
      receiveUpload(
        user,
        created.asset.id,
        uploadRequest(created.asset.id, { 'content-type': 'application/octet-stream', 'x-upload-token': 'bad' }, Buffer.alloc(16)),
      ),
    (err: { status?: number }) => {
      assert.equal(err.status, 400)
      return true
    },
  )
})

test('Content-Type 不是 octet-stream 被拒（415）', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-ctype',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '类型课')
  const user = { ...teacher, displayName: teacher.displayName }

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: 'y.mp4',
    byteSize: 16,
  })

  await assert.rejects(
    () =>
      receiveUpload(
        user,
        created.asset.id,
        uploadRequest(
          created.asset.id,
          { 'content-type': 'video/mp4', 'x-upload-token': created.upload.headers['x-upload-token'] as string },
          Buffer.alloc(16),
        ),
      ),
    (err: { status?: number }) => {
      assert.equal(err.status, 415)
      return true
    },
  )
})

test('字节数与声明不符被拒，素材留在待上传可重试', { skip }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-size',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '字节课')
  const user = { ...teacher, displayName: teacher.displayName }

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: 'z.mp4',
    byteSize: 100,
  })

  await assert.rejects(
    () =>
      receiveUpload(
        user,
        created.asset.id,
        uploadRequest(created.asset.id, created.upload.headers, Buffer.alloc(10)),
      ),
    (err: { status?: number }) => {
      assert.equal(err.status, 400)
      return true
    },
  )

  const items = await listAssets(user, course.id)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.status, 'awaiting_upload')
})

test('凭据过期后重试能重新签发并上传成功', { skip: skip || (hasFfmpeg() ? false : '缺少 ffmpeg') }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-expire',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '过期课')
  const user = { ...teacher, displayName: teacher.displayName }
  const bytes = makeFixture(true)

  const first = await createAsset(user, {
    courseId: course.id,
    fileName: 'exp.mp4',
    byteSize: bytes.length,
  })
  // 模拟「素材建好很久才来上传」：创建时间与凭据有效期都推到过去
  await query(
    `UPDATE media_assets
     SET created_at = now() - interval '2 hours', upload_expires_at = now() - interval '1 hour'
     WHERE id = $1`,
    [first.asset.id],
  )

  const second = await createAsset(user, {
    courseId: course.id,
    fileName: 'exp.mp4',
    byteSize: bytes.length,
  })
  assert.equal(second.asset.id, first.asset.id)
  assert.ok(new Date(second.upload.expiresAt).getTime() > Date.now())

  const asset = await receiveUpload(
    user,
    second.asset.id,
    uploadRequest(second.asset.id, second.upload.headers, bytes),
  )
  assert.equal(asset.status, 'uploaded')
})

test('重传失败不会清掉已上传素材的正式位', { skip: skip || (hasFfmpeg() ? false : '缺少 ffmpeg') }, async () => {
  const teacher = await createAccount({
    username: 'caoshi-keep',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '保留课')
  const user = { ...teacher, displayName: teacher.displayName }
  const bytes = makeFixture(true)

  const created = await createAsset(user, {
    courseId: course.id,
    fileName: 'keep.mp4',
    byteSize: bytes.length,
  })
  await receiveUpload(
    user,
    created.asset.id,
    uploadRequest(created.asset.id, created.upload.headers, bytes),
  )

  const sourceFile = join(mediaDir, 'sources', created.asset.id, 'source')
  assert.ok(existsSync(sourceFile))

  await assert.rejects(
    () =>
      receiveUpload(
        user,
        created.asset.id,
        uploadRequest(created.asset.id, created.upload.headers, Buffer.alloc(10)),
      ),
    (err: { status?: number }) => {
      assert.equal(err.status, 400)
      return true
    },
  )

  assert.ok(existsSync(sourceFile))
})
