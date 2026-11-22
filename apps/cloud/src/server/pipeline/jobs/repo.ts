import 'server-only'
import { query, queryOne, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'

/**
 * 加工任务队列（arch/02 §4）：DB 队列 + worker 认领。
 * 认领用 `FOR UPDATE SKIP LOCKED`，多 worker 并行不抢同一任务。
 * 引用二选一（pipeline_jobs_ref_check）：素材任务挂 asset_id，课程级任务挂 course_id。
 */

export type PipelineJobRow = {
  id: string
  asset_id: string | null
  course_id: string | null
  kind: string
  /** 分段任务跑哪一段（kind='media_stage' 时有值）。 */
  stage: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
  step: string
  progress: string
  attempts: number
  error_code: string | null
  error_message: string | null
  cancel_requested: boolean
  available_at: Date
  locked_by: string | null
  locked_at: Date | null
  heartbeat_at: Date | null
  created_at: Date
  updated_at: Date
}

const COLUMNS = [
  'id',
  'asset_id',
  'course_id',
  'kind',
  'stage',
  'status',
  'step',
  'progress',
  'attempts',
  'error_code',
  'error_message',
  'cancel_requested',
  'available_at',
  'locked_by',
  'locked_at',
  'heartbeat_at',
  'created_at',
  'updated_at',
].join(', ')

/** 退避阶梯（秒）：15 / 60 / 300，逐次放大。 */
const BACKOFF_SECONDS = [15, 60, 300]

export function findJobByAsset(input: {
  assetId: string
  kind: string
}): Promise<PipelineJobRow | null> {
  return queryOne<PipelineJobRow>(
    `SELECT ${COLUMNS} FROM pipeline_jobs WHERE asset_id = $1 AND kind = $2
     ORDER BY created_at DESC LIMIT 1`,
    [input.assetId, input.kind],
  )
}

export function findJobByCourse(input: {
  courseId: string
  kind: string
}): Promise<PipelineJobRow | null> {
  return queryOne<PipelineJobRow>(
    `SELECT ${COLUMNS} FROM pipeline_jobs WHERE course_id = $1 AND kind = $2
     ORDER BY created_at DESC LIMIT 1`,
    [input.courseId, input.kind],
  )
}

/**
 * 素材上任意类型的在跑任务：分段重跑与整条加工互斥——
 * 同一份素材同时跑两个写同一批产物的任务，结果不可预期。
 */
export function findActiveJobByAsset(assetId: string): Promise<PipelineJobRow | null> {
  return queryOne<PipelineJobRow>(
    `SELECT ${COLUMNS} FROM pipeline_jobs
      WHERE asset_id = $1 AND status IN ('queued','running')
      ORDER BY created_at DESC LIMIT 1`,
    [assetId],
  )
}

/** 一批素材的最近一个任务：列表页一次查完，不逐条打库。 */
export async function listLatestJobs(assetIds: string[]): Promise<Map<string, PipelineJobRow>> {
  const map = new Map<string, PipelineJobRow>()
  if (assetIds.length === 0) return map
  const rows = await query<PipelineJobRow>(
    `SELECT DISTINCT ON (asset_id) ${COLUMNS} FROM pipeline_jobs
     WHERE asset_id = ANY($1::text[])
     ORDER BY asset_id, created_at DESC`,
    [assetIds],
  )
  for (const row of rows) if (row.asset_id) map.set(row.asset_id, row)
  return map
}

/**
 * 入队：同一引用同一类型已有在跑任务时直接复用（arch/05 §3.7 幂等）。
 * 终态任务（succeeded/failed/canceled）不复活——重试走显式重新加工/重新起草。
 */
export async function enqueueJob(
  input: { assetId?: string; courseId?: string; kind: string; stage?: string | undefined },
): Promise<PipelineJobRow> {
  const refId = input.assetId ?? input.courseId
  if (!refId || (input.assetId && input.courseId)) {
    throw new Error('enqueueJob：assetId 与 courseId 必须二选一')
  }
  const refCol = input.assetId ? 'asset_id' : 'course_id'
  const initialStep = input.assetId ? 'uploaded' : 'queued'
  return withTransaction(async (client) => {
    const existing = await client.query<PipelineJobRow>(
      `SELECT ${COLUMNS} FROM pipeline_jobs
       WHERE ${refCol} = $1 AND kind = $2 AND status IN ('queued','running')
       ORDER BY created_at DESC LIMIT 1
       FOR UPDATE`,
      [refId, input.kind],
    )
    const row = existing.rows[0]
    if (row) return row

    const inserted = await client.query<PipelineJobRow>(
      `INSERT INTO pipeline_jobs (id, ${refCol}, kind, stage, status, step, available_at)
       VALUES ($1, $2, $3, $4, 'queued', $5, now())
       RETURNING ${COLUMNS}`,
      [newId('pipelineJob'), refId, input.kind, input.stage ?? null, initialStep],
    )
    return inserted.rows[0]!
  })
}

/** 认领一个到期任务：到期且未取消的 queued 任务。 */
export async function claimJob(workerId: string): Promise<PipelineJobRow | null> {
  return withTransaction(async (client) => {
    const claimed = await client.query<PipelineJobRow>(
      `SELECT ${COLUMNS} FROM pipeline_jobs
       WHERE status = 'queued' AND available_at <= now() AND NOT cancel_requested
       ORDER BY available_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    )
    const row = claimed.rows[0]
    if (!row) return null
    const updated = await client.query<PipelineJobRow>(
      `UPDATE pipeline_jobs
       SET status = 'running', attempts = attempts + 1,
           locked_by = $2, locked_at = now(), heartbeat_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [row.id, workerId],
    )
    return updated.rows[0] ?? null
  })
}

export async function heartbeat(jobId: string): Promise<void> {
  await query(`UPDATE pipeline_jobs SET heartbeat_at = now(), updated_at = now() WHERE id = $1`, [jobId])
}

/** 阶段边界回报进度。 */
export async function updateJobProgress(input: {
  jobId: string
  step: string
  progress: number
}): Promise<void> {
  await query(
    `UPDATE pipeline_jobs SET step = $2, progress = $3, updated_at = now() WHERE id = $1`,
    [input.jobId, input.step, input.progress],
  )
}

export async function completeJob(jobId: string, step = 'done'): Promise<void> {
  await query(
    `UPDATE pipeline_jobs
     SET status = 'succeeded', step = $2, progress = 100, error_code = NULL, error_message = NULL,
         locked_by = NULL, updated_at = now()
     WHERE id = $1`,
    [jobId, step],
  )
}

/**
 * 失败：可重试错误回到 queued（退避），终态错误直接 failed。
 * 超过最大尝试次数同样落 failed——否则坏任务会在队列里无限循环。
 * error_code ≤64 字符，客户端只见稳定码。
 *
 * 返回任务最终落到的状态：调用方据此决定素材算「失败」还是「等自动重试」。
 */
export async function failJob(input: {
  jobId: string
  code: string
  message: string
  retryable: boolean
  maxAttempts?: number
}): Promise<'queued' | 'failed'> {
  const code = input.code.slice(0, 64)
  const maxAttempts = input.maxAttempts ?? 5
  if (input.retryable) {
    const job = await queryOne<PipelineJobRow>(
      `SELECT ${COLUMNS} FROM pipeline_jobs WHERE id = $1`,
      [input.jobId],
    )
    const attempts = job?.attempts ?? 1
    if (attempts >= maxAttempts) {
      await query(
        `UPDATE pipeline_jobs
         SET status = 'failed', error_code = $2, error_message = $3,
             locked_by = NULL, updated_at = now()
         WHERE id = $1`,
        [input.jobId, code, input.message],
      )
      return 'failed'
    }
    const delay = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 300
    const jitter = Math.floor(Math.random() * 5)
    await query(
      `UPDATE pipeline_jobs
       SET status = 'queued', error_code = $2, error_message = $3,
           available_at = now() + make_interval(secs => $4),
           locked_by = NULL, locked_at = NULL, heartbeat_at = NULL, updated_at = now()
       WHERE id = $1`,
      [input.jobId, code, input.message, delay + jitter],
    )
    return 'queued'
  }
  await query(
    `UPDATE pipeline_jobs
     SET status = 'failed', error_code = $2, error_message = $3,
         locked_by = NULL, updated_at = now()
     WHERE id = $1`,
    [input.jobId, code, input.message],
  )
  return 'failed'
}

export async function cancelJob(jobId: string): Promise<void> {
  await query(
    `UPDATE pipeline_jobs
     SET status = 'canceled', cancel_requested = false, locked_by = NULL, updated_at = now()
     WHERE id = $1 AND status IN ('queued','running')`,
    [jobId],
  )
}

/** 运行中的任务收到取消请求：worker 在阶段边界中止。 */
export async function requestCancel(jobId: string): Promise<void> {
  await query(
    `UPDATE pipeline_jobs SET cancel_requested = true, updated_at = now()
     WHERE id = $1 AND status = 'running'`,
    [jobId],
  )
}

export async function isCancelRequested(jobId: string): Promise<boolean> {
  const row = await queryOne<{ cancel_requested: boolean }>(
    `SELECT cancel_requested FROM pipeline_jobs WHERE id = $1`,
    [jobId],
  )
  return row?.cancel_requested ?? false
}

/**
 * 撤销取消请求：教师「停止后马上继续」时用。
 *
 * 只清 cancel_requested，不动 status——同一个 job 继续跑，
 * 避免「新建 job」带来的并发认领（同一课的活跃 job 有唯一索引，
 * 且新 worker 起来会重置孤儿 running 步，可能与旧 worker 抢同一步）。
 */
export async function revokeCancel(jobId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE pipeline_jobs SET cancel_requested = false, updated_at = now()
     WHERE id = $1 AND status = 'running' AND cancel_requested = true
     RETURNING id`,
    [jobId],
  )
  return rows.length > 0
}

/**
 * 回收僵尸任务（arch/02 §4）：心跳超时 120 秒的 running 任务回 queued。
 * 超过最大重试次数的落 failed，不再空转。
 *
 * 返回被回收的任务（含素材/课程 ID 与落到的状态），调用方据此同步素材状态。
 * 课程级任务（course_id 非空）由调用方按 kind 分派处理。
 */
export async function reclaimStaleJobs(
  maxAttempts = 5,
  staleSeconds = 120,
): Promise<
  { id: string; asset_id: string | null; course_id: string | null; kind: string; status: PipelineJobRow['status'] }[]
> {
  return query<
    { id: string; asset_id: string | null; course_id: string | null; kind: string; status: PipelineJobRow['status'] }
  >(
    `UPDATE pipeline_jobs
     SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'queued' END,
         available_at = now(),
         locked_by = NULL, locked_at = NULL, heartbeat_at = NULL,
         error_code = 'worker_heartbeat_lost',
         error_message = '任务心跳超时，已回收',
         updated_at = now()
     WHERE status = 'running' AND heartbeat_at < now() - make_interval(secs => $2)
     RETURNING id, asset_id, course_id, kind, status`,
    [maxAttempts, staleSeconds],
  )
}
