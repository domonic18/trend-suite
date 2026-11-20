import 'server-only'
import { hostname } from 'node:os'
import { getMediaStore } from '../store'
import { findAssetById } from '../repo'
import {
  ProcessingCancelledError,
  ProcessingError,
  runProcessing,
} from '../processing/runner'
import { understandStage } from '../processing/understand'
import * as procRepo from '../processing/repo'
import * as jobs from './repo'
import { DEFAULT_STALL_TIMEOUT_MS, isStalled } from './stall'
import { runCurriculumDraft } from '@/server/content/plans/drafter'
import { runProductionRun } from '@/server/production/runner'
import type { PipelineJobRow } from './repo'

/**
 * 加工 worker（arch/02 §4）：认领任务 → 按 kind 分派 → 回写状态。
 * 与 Web 进程同一个镜像，靠 APP_ROLE=worker 区分（arch/02 §7）。
 * asset 任务（ingest）走媒体管线；course 任务（curriculum_draft）走方案起草。
 */

const POLL_INTERVAL_MS = 2_000
const HEARTBEAT_INTERVAL_MS = 10_000
const RECLAIM_INTERVAL_MS = 30_000
// 测试钩子（验收③杀进程续跑）：注入缩小的心跳超时，避免等真实 120 秒。
const RECLAIM_STALE_SECS = Number(process.env.WORKER_RECLAIM_STALE_SECS ?? 120)
// 停滞自愈阈值：这么久没有一次成功的数据库往返就判定 worker 卡死，进程退出，
// 由容器 restart 策略拉起来重新认领（2026-11-20 预发实锤的卡死形态就是认领查询挂住）。
const STALL_TIMEOUT_MS = Number(process.env.WORKER_STALL_TIMEOUT_MS ?? DEFAULT_STALL_TIMEOUT_MS)
const STALL_CHECK_INTERVAL_MS = 15_000

/** 最近一次成功数据库往返的时刻：认领查询成功或心跳写成功都会刷新。 */
let lastAliveAt = Date.now()
/** 当前在处理的任务（停滞日志里报出来，便于定位卡在哪一单）。 */
let currentJobId: string | null = null

export function markAlive(): void {
  lastAliveAt = Date.now()
}

export function workerId(): string {
  return `${hostname()}-${process.pid}`
}

/** 认领并跑一个任务。返回 true 表示确实处理了一个任务。 */
export async function runWorkerOnce(id = workerId()): Promise<boolean> {
  const job = await jobs.claimJob(id)
  markAlive()
  if (!job) return false

  currentJobId = job.id
  const timer = setInterval(() => {
    void jobs
      .heartbeat(job.id)
      .then(() => markAlive())
      .catch(() => undefined)
  }, HEARTBEAT_INTERVAL_MS)

  try {
    switch (job.kind) {
      case 'ingest':
        await runIngestJob(job)
        break
      case 'understand_rerun':
        await runUnderstandJob(job)
        break
      case 'curriculum_draft':
        await runCurriculumDraft(job)
        break
      case 'production_run':
        await runProductionRun(job)
        break
      default:
        await jobs.failJob({
          jobId: job.id,
          code: 'job_kind_unknown',
          message: `未知任务类型：${job.kind}`,
          retryable: false,
        })
    }
  } finally {
    clearInterval(timer)
    currentJobId = null
  }
  return true
}

/** 素材加工（迭代 2 链路，原逻辑不变）。 */
async function runIngestJob(job: PipelineJobRow): Promise<void> {
  const assetId = job.asset_id
  if (!assetId) {
    await jobs.failJob({ jobId: job.id, code: 'asset_not_found', message: '素材不存在', retryable: false })
    return
  }
  try {
    const asset = await findAssetById(assetId)
    if (!asset) {
      await jobs.failJob({
        jobId: job.id,
        code: 'asset_not_found',
        message: '素材不存在',
        retryable: false,
      })
      return
    }
    if (!asset.source_path) {
      await jobs.failJob({
        jobId: job.id,
        code: 'asset_source_missing',
        message: '素材原片缺失',
        retryable: false,
      })
      await procRepo.setAssetStatus({
        assetId: asset.id,
        status: 'failed',
        errorCode: 'asset_source_missing',
        errorMessage: '素材原片缺失',
        message: '加工失败',
        progress: 0,
      })
      return
    }

    const durationS = asset.duration_s === null ? 0 : Number(asset.duration_s)
    const sourcePath = await getMediaStore().sourcePath(asset.id)
    const framesDir = getMediaStore().framesDir(asset.id)

    await procRepo.setAssetStatus({ assetId: asset.id, status: 'processing' })

    await runProcessing({
      assetId: asset.id,
      courseId: asset.course_id,
      sourcePath,
      durationS,
      framesDir,
      shouldCancel: async () => jobs.isCancelRequested(job.id),
      onProgress: async (input) => {
        await jobs.updateJobProgress({
          jobId: job.id,
          step: input.step,
          progress: input.progress,
        })
        await procRepo.setAssetProgress({
          assetId: asset.id,
          step: input.step,
          progress: input.progress,
          message: input.message ?? null,
        })
      },
    })

    await jobs.completeJob(job.id)
    await procRepo.setAssetProgress({
      assetId: asset.id,
      step: 'done',
      progress: 100,
      message: '就绪',
    })
    await procRepo.setAssetStatus({ assetId: asset.id, status: 'ready' })
  } catch (err) {
    if (err instanceof ProcessingCancelledError) {
      await jobs.cancelJob(job.id)
      await procRepo.setAssetStatus({
        assetId,
        status: 'uploaded',
        errorCode: 'canceled',
        errorMessage: '已取消',
        message: '已取消',
        progress: 0,
      })
      return
    }
    const retryable = err instanceof ProcessingError ? err.retryable : true
    const code = err instanceof ProcessingError ? err.code : 'processing_failed'
    const message = (err as Error).message
    const outcome = await jobs.failJob({
      jobId: job.id,
      code,
      message,
      retryable,
    })
    if (outcome === 'queued') {
      // 任务已回队列等自动重试——素材不算失败，否则页面上的「重试」按钮会撞上
      // 「加工任务正在进行中」（任务确实还在队列里）。
      await procRepo.setAssetStatus({
        assetId,
        status: 'uploaded',
        errorCode: code,
        errorMessage: message,
        message: '失败，将自动重试',
        progress: 0,
      })
      return
    }
    await procRepo.setAssetStatus({
      assetId,
      status: 'failed',
      errorCode: code,
      errorMessage: message,
      message: '加工失败',
      progress: 0,
    })
  }
}

/**
 * 重跑理解（迭代 8）：只跑理解阶段，转写与关键帧保留。
 * 幂等按 transcript_segments.chunk_index 去重——已理解的块跳过，只补缺口。
 * 智能规划要用素材的教学要点，存量素材没有理解结果时从这里补。
 */
async function runUnderstandJob(job: PipelineJobRow): Promise<void> {
  const assetId = job.asset_id
  if (!assetId) {
    await jobs.failJob({ jobId: job.id, code: 'asset_not_found', message: '素材不存在', retryable: false })
    return
  }
  try {
    const asset = await findAssetById(assetId)
    if (!asset) {
      await jobs.failJob({ jobId: job.id, code: 'asset_not_found', message: '素材不存在', retryable: false })
      return
    }
    if (asset.status !== 'ready') {
      await jobs.failJob({
        jobId: job.id,
        code: 'asset_not_ready',
        message: '素材尚未就绪，先完成加工再重跑理解',
        retryable: false,
      })
      return
    }
    const store = getMediaStore()
    // 理解阶段的进度消息（如「理解完成」/「理解未完成（2 块失败）」）留在素材上，
    // 但阶段要回到 done——素材本来就绪，停在 understand 会让步进条永远停在半路。
    let lastMessage: string | null = null
    await understandStage({
      assetId: asset.id,
      courseId: asset.course_id,
      sourcePath: await store.sourcePath(asset.id),
      durationS: Number(asset.duration_s ?? 0),
      framesDir: store.framesDir(asset.id),
      shouldCancel: async () => jobs.isCancelRequested(job.id),
      onProgress: async (input) => {
        lastMessage = input.message ?? null
        await jobs.updateJobProgress({
          jobId: job.id,
          step: input.step,
          progress: input.progress,
        })
        await procRepo.setAssetProgress({
          assetId: asset.id,
          step: input.step,
          progress: input.progress,
          message: input.message ?? null,
        })
      },
    })
    await procRepo.setAssetProgress({
      assetId: asset.id,
      step: 'done',
      progress: 100,
      message: lastMessage ?? '就绪',
    })
    await jobs.completeJob(job.id)
  } catch (err) {
    await procRepo.setAssetProgress({
      assetId,
      step: 'done',
      progress: 100,
      message: `理解失败：${(err as Error).message.slice(0, 80)}，重跑可补齐`,
    })
    await jobs.failJob({
      jobId: job.id,
      code: 'understand_failed',
      message: (err as Error).message,
      retryable: false,
    })
  }
}

/** worker 主循环：空转时按固定间隔轮询；每 30s 回收心跳丢失的任务。 */
export async function startWorker(): Promise<void> {
  const id = workerId()
  console.log(`[worker] 启动 ${id}（停滞阈值 ${STALL_TIMEOUT_MS}ms）`)
  await reclaimAndSync().catch(() => 0)
  let lastReclaim = Date.now()
  const watchdog = setInterval(() => {
    if (!isStalled({ lastAliveAt, now: Date.now(), timeoutMs: STALL_TIMEOUT_MS })) return
    console.error(
      `[worker] ${STALL_TIMEOUT_MS}ms 内没有成功的数据库往返（当前任务 ${currentJobId ?? '无'}），` +
        '判定卡死，退出进程交由容器重启策略恢复',
    )
    process.exit(1)
  }, STALL_CHECK_INTERVAL_MS)
  watchdog.unref()
  for (;;) {
    let handled = false
    try {
      handled = await runWorkerOnce(id)
    } catch (err) {
      console.error('[worker] 任务处理异常', err)
    }
    if (Date.now() - lastReclaim >= RECLAIM_INTERVAL_MS) {
      lastReclaim = Date.now()
      await reclaimAndSync().catch(() => 0)
    }
    if (!handled) await delay(POLL_INTERVAL_MS)
  }
}

/** 回收僵尸任务并同步素材状态：回收成 failed 的素材标失败，回队列的标待重试。课程级任务无素材状态可同步。 */
async function reclaimAndSync(): Promise<void> {
  const reclaimed = await jobs.reclaimStaleJobs(5, RECLAIM_STALE_SECS)
  markAlive()
  for (const row of reclaimed) {
    if (!row.asset_id) continue
    if (row.status === 'failed') {
      await procRepo.setAssetStatus({
        assetId: row.asset_id,
        status: 'failed',
        errorCode: 'worker_heartbeat_lost',
        errorMessage: '任务心跳超时，已回收',
        message: '加工失败',
        progress: 0,
      })
    } else {
      await procRepo.setAssetStatus({
        assetId: row.asset_id,
        status: 'uploaded',
        errorCode: 'worker_heartbeat_lost',
        errorMessage: '任务心跳超时，已重新排队',
        message: '心跳超时，已重新排队',
        progress: 0,
      })
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
