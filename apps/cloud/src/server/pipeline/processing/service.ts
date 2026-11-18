import 'server-only'
import {
  type JobStatus,
  type MediaAssetView,
  type MediaFrameListResponse,
  type SessionUser,
  type TranscriptResponse,
} from '@trend-suite/contracts'
import { getCourseForUser } from '@/server/content/service'
import { HttpError, conflict, notFound } from '@/server/lib/http'
import * as jobRepo from '../jobs/repo'
import * as repo from '../repo'
import { signFrameUrl } from './frame-url'
import * as procRepo from './repo'

/**
 * 加工域服务（arch/05 §3.7）：
 * - 触发加工入队；force=true 清旧产物重跑；
 * - 逐字稿与关键帧可读——转写进行中先给 partial 段落，不等全量完成；
 * - 重试不重算已完成部分：已转块保留，只补没转完的。
 */

export async function ingestAsset(
  user: SessionUser,
  assetId: string,
  input: { force?: boolean | undefined } = {},
): Promise<{ asset: MediaAssetView; jobId: string }> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)
  if (row.status === 'awaiting_upload') {
    throw conflict('素材尚未上传完成，不能开始加工')
  }

  if (input.force) {
    await procRepo.clearSegments(assetId)
    await procRepo.clearFrames(assetId)
    await procRepo.setAssetCounts({ assetId, segmentCount: 0, frameCount: 0 })
    await procRepo.setAssetProgress({ assetId, step: 'uploaded', progress: 0, message: null })
  }

  const job = await jobRepo.enqueueJob({ assetId, kind: 'ingest' })
  await procRepo.setAssetProgress({
    assetId,
    step: 'uploaded',
    progress: 0,
    message: '排队中',
  })
  await procRepo.setAssetStatus({ assetId, status: 'uploaded' })
  const updated = await repo.findAssetById(assetId)
  return {
    asset: {
      ...toView(updated!),
      jobStatus: job.status as JobStatus,
    },
    jobId: job.id,
  }
}

/** 重试：只重跑没做完的部分（已转块、已抽帧保留）。 */
export async function retryAsset(
  user: SessionUser,
  assetId: string,
): Promise<{ asset: MediaAssetView; jobId: string }> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  const existing = await jobRepo.findJobByAsset({ assetId, kind: 'ingest' })
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    throw conflict('加工任务正在进行中')
  }
  // 失败的任务先落终态，再入新任务：同一素材同一类型同时最多一个在跑。
  if (existing && existing.status === 'failed') {
    await jobRepo.cancelJob(existing.id)
  }

  const job = await jobRepo.enqueueJob({ assetId, kind: 'ingest' })
  await procRepo.setAssetProgress({
    assetId,
    step: 'uploaded',
    progress: 0,
    message: '排队中',
  })
  await procRepo.setAssetStatus({ assetId, status: 'uploaded' })
  const updated = await repo.findAssetById(assetId)
  return {
    asset: { ...toView(updated!), jobStatus: job.status as JobStatus },
    jobId: job.id,
  }
}

/**
 * 停止加工（T19）：排队中直接取消；运行中置取消标记，worker 在阶段边界
 * 安全中止并把素材拨回「已上传」。已转块与关键帧保留，重新加工按块去重续转。
 */
export async function cancelMaterialProcessing(
  user: SessionUser,
  assetId: string,
): Promise<{ asset: MediaAssetView }> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  const job = await jobRepo.findJobByAsset({ assetId, kind: 'ingest' })
  if (!job || (job.status !== 'queued' && job.status !== 'running')) {
    throw new HttpError(409, 'material_not_processing', '素材没有进行中的加工任务')
  }
  if (job.status === 'queued') {
    await jobRepo.cancelJob(job.id)
    await procRepo.setAssetProgress({ assetId, step: 'uploaded', progress: 0, message: '已停止' })
    await procRepo.setAssetStatus({ assetId, status: 'uploaded' })
  } else {
    await jobRepo.requestCancel(job.id)
    await procRepo.setAssetProgress({
      assetId,
      step: row.process_step as MediaAssetView['processStep'],
      progress: Number(row.process_progress),
      message: '正在停止…',
    })
  }
  const updated = await repo.findAssetById(assetId)
  const latest = await jobRepo.findJobByAsset({ assetId, kind: 'ingest' })
  return {
    asset: { ...toView(updated!), jobStatus: (latest?.status ?? null) as JobStatus | null },
  }
}

export async function getTranscript(
  user: SessionUser,
  assetId: string,
): Promise<TranscriptResponse> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  const segments = await procRepo.listSegments(assetId)
  return {
    assetId,
    complete: segments.length > 0 && segments.every((s) => !s.partial),
    segments: segments.map((segment) => ({
      id: segment.id,
      assetId: segment.asset_id,
      seq: segment.seq,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      speaker: segment.speaker,
      text: segment.text,
      unitId: segment.unit_id,
      partial: segment.partial,
    })),
  }
}

export async function getFrames(
  user: SessionUser,
  assetId: string,
): Promise<MediaFrameListResponse> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  const frames = await procRepo.listFrames(assetId)
  return {
    items: frames.map((frame) => ({
      id: frame.id,
      assetId: frame.asset_id,
      atMs: frame.at_ms,
      url: signFrameUrl({ assetId, frameId: frame.id }),
      width: frame.width,
      height: frame.height,
      caption: frame.caption,
    })),
  }
}

/** 取一张帧图：签名已验，落盘路径交给路由层流式回给浏览器。 */
export async function findFrameFile(input: {
  assetId: string
  frameId: string
}): Promise<{ path: string } | null> {
  const frame = await procRepo.findFrame({ assetId: input.assetId, frameId: input.frameId })
  return frame ? { path: frame.path } : null
}

/** 加工状态：阶段、进度、任务状态。 */
export async function getProcessingState(
  user: SessionUser,
  assetId: string,
): Promise<{ asset: MediaAssetView; jobStatus: JobStatus | null }> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)
  const job = await jobRepo.findJobByAsset({ assetId, kind: 'ingest' })
  return { asset: toView(row), jobStatus: job?.status ?? null }
}

function toView(row: repo.MediaAssetRow): MediaAssetView {
  return {
    id: row.id,
    courseId: row.course_id,
    fileName: row.original_name ?? '',
    status: row.status as MediaAssetView['status'],
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    sha256: row.sha256,
    durationS: row.duration_s === null ? null : Number(row.duration_s),
    videoOk: row.video_ok,
    audioOk: row.audio_ok,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    processStep: row.process_step as MediaAssetView['processStep'],
    processProgress: Number(row.process_progress),
    processMessage: row.process_message,
    jobStatus: null,
    segmentCount: row.segment_count,
    frameCount: row.frame_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}
