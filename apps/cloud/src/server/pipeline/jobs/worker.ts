import 'server-only'
import { hostname } from 'node:os'
import type { MediaStage } from '@trend-suite/contracts'
import { getMediaStore } from '../store'
import { findAssetById } from '../repo'
import {
  ProcessingCancelledError,
  ProcessingError,
  framesStage,
  runProcessing,
  transcriptStage,
  type ProcessingContext,
} from '../processing/runner'
import { understandStage } from '../processing/understand'
import * as procRepo from '../processing/repo'
import { setStageState } from '../stage-repo'
import * as jobs from './repo'
import { DEFAULT_STALL_TIMEOUT_MS, isStalled } from './stall'
import { runCurriculumDraft } from '@/server/content/plans/drafter'
import { runProductionRun } from '@/server/production/runner'
import { runAgentChat } from '@/server/agent-chat/engine'
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
        await runStageJob(job, 'understanding')
        break
      case 'media_stage':
        await runStageJob(job, (job.stage ?? 'transcript') as MediaStage)
        break
      case 'curriculum_draft':
        await runCurriculumDraft(job)
        break
      case 'production_run':
        await runProductionRun(job)
        break
      case 'agent_chat':
        // 会话任务：引擎按「有待处理输入的线程」解析并排空，失败落成 err event
        // 后按成功收口（不重试）；跨线程待处理输入由引擎收口后自行入队续跑。
        await runAgentChat(job)
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
 * 分段任务：只跑指定的那一段（逐字稿 / 关键帧 / 视频理解）。
 *
 * 段状态落 media_asset_stages：跑完按实际产出落「完成 / 空」，
 * 产出不全落「部分完成」并带上原因——教师一眼看得出哪一段没跑完。
 * 失败不影响素材整体就绪态：另外两段的产物照旧可用。
 */
async function runStageJob(job: PipelineJobRow, stage: MediaStage): Promise<void> {
  const assetId = job.asset_id
  let lastStep: string | null = null
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
    if (!asset.source_path) {
      await jobs.failJob({
        jobId: job.id,
        code: 'asset_source_missing',
        message: '素材原片缺失',
        retryable: false,
      })
      await setStageState({
        assetId,
        stage,
        status: 'failed',
        errorMessage: '素材原片缺失',
      })
      return
    }

    const store = getMediaStore()
    let lastMessage: string | null = null
    const ctx: ProcessingContext = {
      assetId: asset.id,
      courseId: asset.course_id,
      sourcePath: await store.sourcePath(asset.id),
      durationS: Number(asset.duration_s ?? 0),
      framesDir: store.framesDir(asset.id),
      shouldCancel: async () => jobs.isCancelRequested(job.id),
      onProgress: async (input) => {
        lastMessage = input.message ?? null
        lastStep = input.step
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
    }

    if (stage === 'transcript') await transcriptStage(ctx)
    else if (stage === 'frames') await framesStage(ctx)
    else await understandStage(ctx)

    const count = await countStageProducts(assetId, stage)
    const incomplete = lastMessage !== null && /未完成|失败/.test(lastMessage)
    await setStageState({
      assetId,
      stage,
      status: incomplete ? (count > 0 ? 'partial' : 'failed') : count > 0 ? 'done' : 'empty',
      errorMessage: incomplete ? lastMessage : null,
    })
    await syncAssetCounts(assetId)
    await jobs.completeJob(job.id)
    await procRepo.setAssetProgress({
      assetId,
      step: 'done',
      progress: 100,
      message: lastMessage ?? '就绪',
    })
  } catch (err) {
    if (err instanceof ProcessingCancelledError) {
      await jobs.cancelJob(job.id)
      await setStageState({ assetId, stage, status: 'empty' })
      await procRepo.setAssetProgress({
        assetId,
        step: 'done',
        progress: 100,
        message: '已取消',
      })
      return
    }
    const message = (err as Error).message
    await setStageState({ assetId, stage, status: 'failed', errorMessage: message })
    await jobs.failJob({
      jobId: job.id,
      code: err instanceof ProcessingError ? err.code : 'stage_failed',
      message,
      retryable: err instanceof ProcessingError ? err.retryable : true,
    })
    // 段失败不动素材的完成态：另外两段可能还好，失败的是哪一段由段台账说。
    await procRepo.setAssetProgress({
      assetId,
      step: lastStep ?? 'uploaded',
      progress: 0,
      message: `重跑可补齐：${message.slice(0, 80)}`,
    })
  }
}

/** 某一段的产出条数：段状态落「完成 / 空」按它判。 */
async function countStageProducts(assetId: string, stage: MediaStage): Promise<number> {
  if (stage === 'transcript') return procRepo.countSegments(assetId)
  if (stage === 'frames') return procRepo.countFrames(assetId)
  return procRepo.countSourceUnits(assetId)
}

/** 段产物变了，素材上的缓存计数跟着刷新。 */
async function syncAssetCounts(assetId: string): Promise<void> {
  const [segmentCount, frameCount] = await Promise.all([
    procRepo.countSegments(assetId),
    procRepo.countFrames(assetId),
  ])
  await procRepo.setAssetCounts({ assetId, segmentCount, frameCount })
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
