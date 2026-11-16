import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import * as procRepo from './repo'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

async function makeAsset(): Promise<string> {
  const teacher = await createAccount({
    username: `proc-${Math.random().toString(36).slice(2, 8)}`,
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '落库课')
  const assetId = `ma_proc_${Math.random().toString(36).slice(2, 10)}`
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, status)
     VALUES ($1, $2, '录像.mp4', 'uploaded')`,
    [assetId, course.id],
  )
  return assetId
}

test('已转块登记在段落上：completedChunkIndexes 按 chunk_index 去重', { skip }, async () => {
  const assetId = await makeAsset()

  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 0,
    segments: [{ seq: 0, startMs: 0, endMs: 1500, text: '第一段', speaker: null }],
  })
  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 0,
    segments: [{ seq: 100_000, startMs: 1000, endMs: 2500, text: '第二段', speaker: null }],
  })
  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 2,
    segments: [{ seq: 200_000, startMs: 2000, endMs: 3500, text: '第三段', speaker: null }],
  })

  const done = await procRepo.completedChunkIndexes(assetId)
  assert.deepEqual([...done].sort((a, b) => a - b), [0, 2])
})

test('重跑同一块不产生重复段落：ON CONFLICT 按 (asset_id, seq) 挡', { skip }, async () => {
  const assetId = await makeAsset()

  const first = await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 1,
    segments: [
      { seq: 100_000, startMs: 0, endMs: 1000, text: '第一次转写', speaker: null },
    ],
  })
  assert.equal(first, 1)

  // 上游重试同一输出：同 seq 不再写
  const rerun = await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 1,
    segments: [
      { seq: 100_000, startMs: 0, endMs: 1000, text: '第一次转写', speaker: null },
    ],
  })
  assert.equal(rerun, 1)

  const segments = await procRepo.listSegments(assetId)
  assert.equal(segments.length, 1)
  assert.equal(await procRepo.countSegments(assetId), 1)
  assert.equal(segments[0]?.text, '第一次转写')
})

test('重排把块内基址序号压成连续序号，时间顺序保持', { skip }, async () => {
  const assetId = await makeAsset()

  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 0,
    segments: [
      { seq: 0, startMs: 5000, endMs: 6500, text: 'B', speaker: null },
      { seq: 1, startMs: 0, endMs: 1500, text: 'A', speaker: null },
    ],
  })
  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 3,
    segments: [{ seq: 300_000, startMs: 9000, endMs: 10000, text: 'C', speaker: null }],
  })

  // 按时间序重排（转写侧落库时已经是时间序，这里直接模拟收尾）
  const ordered = await procRepo.listSegments(assetId)
  const byTime = [...ordered].sort((a, b) => a.start_ms - b.start_ms)
  await procRepo.renumber(byTime.map((s) => s.id))

  const renumbered = await procRepo.listSegments(assetId)
  assert.deepEqual(
    renumbered.map((s) => [s.seq, s.text]),
    [
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
    ],
  )
})

test('转写收尾：所有段落 partial=false；段落可读（partial=true 先行可见）', { skip }, async () => {
  const assetId = await makeAsset()

  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 0,
    segments: [{ seq: 0, startMs: 0, endMs: 1500, text: '边转边读', speaker: null }],
  })

  const partialView = await procRepo.listSegments(assetId)
  assert.equal(partialView[0]?.partial, true)

  await procRepo.finalizeSegments(assetId)

  const finalView = await procRepo.listSegments(assetId)
  assert.equal(finalView[0]?.partial, false)
})

test('关键帧按时间点幂等：同 at_ms 重跑只刷新不重复', { skip }, async () => {
  const assetId = await makeAsset()

  await procRepo.upsertFrames({
    assetId,
    frames: [{ atMs: 15_000, path: '/frames/15000.jpg', width: 1280, height: 720 }],
  })
  await procRepo.upsertFrames({
    assetId,
    frames: [{ atMs: 15_000, path: '/frames/15000-retry.jpg', width: 1280, height: 720 }],
  })

  const frames = await procRepo.listFrames(assetId)
  assert.equal(frames.length, 1)
  assert.equal(frames[0]?.path, '/frames/15000-retry.jpg')
  assert.equal(await procRepo.countFrames(assetId), 1)
})

test('强制重转清旧产物：段落与帧清零', { skip }, async () => {
  const assetId = await makeAsset()

  await procRepo.insertChunkSegments({
    assetId,
    chunkIndex: 0,
    segments: [{ seq: 0, startMs: 0, endMs: 1500, text: '旧段落', speaker: null }],
  })
  await procRepo.upsertFrames({
    assetId,
    frames: [{ atMs: 0, path: '/frames/0.jpg', width: 1280, height: 720 }],
  })

  await procRepo.clearSegments(assetId)
  await procRepo.clearFrames(assetId)

  assert.equal(await procRepo.countSegments(assetId), 0)
  assert.equal(await procRepo.countFrames(assetId), 0)
  assert.deepEqual([...await procRepo.completedChunkIndexes(assetId)], [])
})
