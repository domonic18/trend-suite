import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import * as jobs from './repo'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

async function makeAsset(): Promise<{ courseId: string; assetId: string }> {
  const teacher = await createAccount({
    username: `queue-${Math.random().toString(36).slice(2, 8)}`,
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '队列课')
  const assetId = `ma_que_${Math.random().toString(36).slice(2, 10)}`
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, status)
     VALUES ($1, $2, '录像.mp4', 'uploaded')`,
    [assetId, course.id],
  )
  return { courseId: course.id, assetId }
}

test('入队后可认领：状态转 running，写 worker 标识；第二个 worker 无任务', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })

  const claimed = await jobs.claimJob('worker-A')
  assert.ok(claimed)
  assert.equal(claimed.id, job.id)
  assert.equal(claimed.status, 'running')
  assert.equal(claimed.attempts, 1)
  assert.equal(claimed.locked_by, 'worker-A')
  assert.ok(claimed.heartbeat_at !== null)

  const second = await jobs.claimJob('worker-B')
  assert.equal(second, null)
})

test('同一素材同一类型同时只留一个在跑的任务', { skip }, async () => {
  const { assetId } = await makeAsset()
  const first = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')

  // 已 running 时再次入队：复用原任务，不产生第二个
  const again = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  assert.equal(again.id, first.id)
})

test('可重试错误回队列（带退避）：到期前认领不到', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')

  const outcome = await jobs.failJob({
    jobId: job.id,
    code: 'asr_timeout',
    message: 'ASR 上游超时',
    retryable: true,
  })
  assert.equal(outcome, 'queued')

  const [row] = await query<{ status: string; available_at: Date }>(
    `SELECT status, available_at FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'queued')
  assert.ok(new Date(row?.available_at ?? 0).getTime() > Date.now())
  assert.equal(await jobs.claimJob('worker-A'), null)

  // 到期后可再认领，attempts 递增
  await query(`UPDATE pipeline_jobs SET available_at = now() - interval '1 second' WHERE id = $1`, [job.id])
  const reclaimed = await jobs.claimJob('worker-A')
  assert.equal(reclaimed?.id, job.id)
  assert.equal(reclaimed?.attempts, 2)
})

test('可重试错误在尝试次数顶格后落 failed：不再空转', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')
  await query(`UPDATE pipeline_jobs SET attempts = 5 WHERE id = $1`, [job.id])

  const outcome = await jobs.failJob({
    jobId: job.id,
    code: 'asr_timeout',
    message: 'ASR 上游超时',
    retryable: true,
    maxAttempts: 5,
  })
  assert.equal(outcome, 'failed')

  const [row] = await query<{ status: string; error_code: string }>(
    `SELECT status, error_code FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'failed')
  assert.equal(row?.error_code, 'asr_timeout')
  assert.equal(await jobs.claimJob('worker-A'), null)
})

test('终态错误直接 failed：不再回队列', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')

  const outcome = await jobs.failJob({
    jobId: job.id,
    code: 'media_invalid',
    message: '素材已损坏',
    retryable: false,
  })
  assert.equal(outcome, 'failed')

  const [row] = await query<{ status: string; error_code: string }>(
    `SELECT status, error_code FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'failed')
  assert.equal(row?.error_code, 'media_invalid')
  assert.equal(await jobs.claimJob('worker-A'), null)
})

test('错误码截到 64 字符，客户端只见稳定码', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')

  await jobs.failJob({
    jobId: job.id,
    code: 'x'.repeat(200),
    message: '超长错误码',
    retryable: false,
  })

  const [row] = await query<{ error_code: string }>(
    `SELECT error_code FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.error_code.length, 64)
})

test('心跳超时的 running 任务被回收；超过最大尝试次数直接判死', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')
  await query(
    `UPDATE pipeline_jobs SET heartbeat_at = now() - interval '3 minutes' WHERE id = $1`,
    [job.id],
  )

  const reclaimed = await jobs.reclaimStaleJobs()
  assert.equal(reclaimed.length, 1)
  assert.equal(reclaimed[0]?.asset_id, assetId)
  assert.equal(reclaimed[0]?.status, 'queued')

  const [row] = await query<{ status: string; error_code: string }>(
    `SELECT status, error_code FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'queued')
  assert.equal(row?.error_code, 'worker_heartbeat_lost')

  // attempts 顶格后回收即 failed，不再空转
  await jobs.claimJob('worker-B')
  await query(
    `UPDATE pipeline_jobs SET attempts = 5, heartbeat_at = now() - interval '3 minutes' WHERE id = $1`,
    [job.id],
  )
  await jobs.reclaimStaleJobs(5)

  const [dead] = await query<{ status: string }>(
    `SELECT status FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(dead?.status, 'failed')
})

test('完成：状态 succeeded，进度 100', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')
  await jobs.updateJobProgress({ jobId: job.id, step: 'transcribe', progress: 55 })

  await jobs.completeJob(job.id)

  const [row] = await query<{ status: string; step: string; progress: string }>(
    `SELECT status, step, progress FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'succeeded')
  assert.equal(row?.step, 'done')
  assert.equal(Number(row?.progress), 100)
  assert.equal(await jobs.claimJob('worker-A'), null)
})

test('取消：running 任务被请求取消后，worker 在边界读到请求', { skip }, async () => {
  const { assetId } = await makeAsset()
  const job = await jobs.enqueueJob({ assetId, kind: 'ingest' })
  await jobs.claimJob('worker-A')

  await jobs.requestCancel(job.id)
  assert.equal(await jobs.isCancelRequested(job.id), true)

  await jobs.cancelJob(job.id)
  assert.equal(await jobs.isCancelRequested(job.id), false)
  const [row] = await query<{ status: string }>(
    `SELECT status FROM pipeline_jobs WHERE id = $1`,
    [job.id],
  )
  assert.equal(row?.status, 'canceled')
})
