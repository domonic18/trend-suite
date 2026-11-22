import 'server-only'
import { rm } from 'node:fs/promises'
import { getEnv } from '@/env'
import { resolveAsrChannel } from '@/server/models/service'
import { transcribeFile, AsrError } from '../asr/client'
import { splitLongSegments, toGlobalSegments } from '../asr/parse'
import { cutChunk, detectSilence, extractAudio, planAudioChunks } from './audio'
import { extractFrames } from './frames'
import { transcodeStage } from './transcode'
import { understandStage } from './understand'
import * as repo from './repo'
import { assetWorkDir } from './paths'

/**
 * 加工编排（arch/05 §3.7）：阶段序列 probe → transcribe → transcode → frames
 * → understand → finalize → done。
 *
 * 幂等三原则：
 * - 已转块跳过（transcript_segments.chunk_index），重跑不重复计费；
 * - 已抽帧刷新不重复（media_frames 唯一键）；
 * - 产物一次性写，单块段落单事务落库，绝不部分落库。
 *
 * 增量可见：每转完一块立即落 partial 段落，工作台可以边转边读。
 */

/** 段落 seq 的块内基址：块间留足间隔，最后统一重排成连续序号。 */
const SEQ_STRIDE = 100_000

export type ProcessingContext = {
  assetId: string
  /** 所属课程（理解阶段落 source_units 需要课程维度）。 */
  courseId: string
  /** 素材原片的可读路径。 */
  sourcePath: string
  durationS: number
  /** 关键帧落盘目录（持久位）。 */
  framesDir: string
  /** 阶段边界检查取消。 */
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
  /** 阶段内回报进度。 */
  onProgress?: (input: { step: string; progress: number; message?: string | null }) => void | Promise<void>
}

export class ProcessingCancelledError extends Error {
  constructor() {
    super('任务已取消')
    this.name = 'ProcessingCancelledError'
  }
}

export class ProcessingError extends Error {
  readonly retryable: boolean
  readonly code: string

  constructor(message: string, options: { retryable: boolean; code: string }) {
    super(message)
    this.name = 'ProcessingError'
    this.retryable = options.retryable
    this.code = options.code
  }
}

export async function runProcessing(ctx: ProcessingContext): Promise<void> {
  await transcriptStage(ctx)

  await transcodeStage(ctx)

  await framesStage(ctx)

  await understandStage(ctx)

  await ctx.onProgress?.({ step: 'index', progress: 94, message: '建立索引' })
  await repo.finalizeSegments(ctx.assetId)
  const [segmentCount, frameCount] = await Promise.all([
    repo.countSegments(ctx.assetId),
    repo.countFrames(ctx.assetId),
  ])
  await repo.setAssetCounts({ assetId: ctx.assetId, segmentCount, frameCount })
  await ctx.onProgress?.({ step: 'done', progress: 100, message: '就绪' })

  await rm(assetWorkDir(ctx.assetId), { recursive: true, force: true })
}

/**
 * 转写段（可单独重跑）：抽音频 → 分块转写 → 逐块落库 → 定稿。
 * 已转块跳过（transcript_segments.chunk_index），重跑不重复计费。
 */
export async function transcriptStage(ctx: ProcessingContext): Promise<void> {
  await ctx.onProgress?.({ step: 'audio', progress: 2, message: '抽取音频' })
  const audio = await extractAudio({
    assetId: ctx.assetId,
    sourcePath: ctx.sourcePath,
    durationS: ctx.durationS,
    shouldCancel: ctx.shouldCancel,
  })

  await transcribeChunks(ctx, audio)
  await repo.finalizeSegments(ctx.assetId)
}

/** 关键帧段（可单独重跑）：抽帧并落库，同一时间点只留一张，重跑只刷新。 */
export async function framesStage(ctx: ProcessingContext): Promise<void> {
  await ctx.onProgress?.({ step: 'frames', progress: 78, message: '抽取关键帧' })
  const frames = await extractFrames({
    assetId: ctx.assetId,
    sourcePath: ctx.sourcePath,
    framesDir: ctx.framesDir,
    shouldCancel: ctx.shouldCancel,
  })
  await repo.upsertFrames({
    assetId: ctx.assetId,
    frames: frames.map((f) => ({
      atMs: f.atMs,
      path: f.path,
      width: f.width,
      height: f.height,
    })),
  })
}

/** 转写阶段：分块 → 并发转写 → 逐块落库。 */
async function transcribeChunks(
  ctx: ProcessingContext,
  audio: { audioPath: string; durationS: number; silenceCuts: number[] },
): Promise<void> {
  const env = getEnv()
  const channel = await resolveAsrChannel()
  const chunks = planAudioChunks({
    durationS: audio.durationS,
    silenceCuts: audio.silenceCuts,
  })
  if (chunks.length === 0) {
    throw new ProcessingError('素材时长为零，无法转写', { retryable: false, code: 'asr_no_duration' })
  }

  const done = await repo.completedChunkIndexes(ctx.assetId)
  const pending = chunks.filter((chunk) => !done.has(chunk.index))
  if (pending.length === 0) return

  const total = chunks.length
  let completed = chunks.length - pending.length
  await ctx.onProgress?.({
    step: 'transcribe',
    progress: 10 + Math.round((completed / total) * 60),
    message: `转写中（${completed}/${total} 块）`,
  })

  const concurrency = Math.max(1, Math.min(env.PIPELINE_ASR_CONCURRENCY, pending.length))
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= pending.length) return
      const chunk = pending[index]!
      if (await ctx.shouldCancel?.()) throw new ProcessingCancelledError()

      const chunkPath = await cutChunk({
        assetId: ctx.assetId,
        audioPath: audio.audioPath,
        chunk,
        shouldCancel: ctx.shouldCancel,
      })
      try {
        const segments = await transcribeChunk(channel, chunkPath, chunk.startS)
        await repo.insertChunkSegments({
          assetId: ctx.assetId,
          chunkIndex: chunk.index,
          segments: segments.map((segment, i) => ({
            seq: chunk.index * SEQ_STRIDE + i,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            speaker: segment.speaker,
          })),
        })
      } finally {
        await rm(chunkPath, { force: true })
      }

      completed += 1
      await ctx.onProgress?.({
        step: 'transcribe',
        progress: 10 + Math.round((completed / total) * 60),
        message: `转写中（${completed}/${total} 块）`,
      })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  await renumberSegments(ctx.assetId)
}

/** 单块转写：失败按可重试语义重试 3 次。 */
async function transcribeChunk(
  channel: Awaited<ReturnType<typeof resolveAsrChannel>>,
  chunkPath: string,
  startS: number,
): Promise<{ startMs: number; endMs: number; text: string; speaker: string | null }[]> {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await transcribeFile(channel, chunkPath)
      const global = toGlobalSegments(result.segments, Math.round(startS * 1000))
      const split = splitLongSegments(global)
      if (split.length > 0) {
        return split.map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
          text: s.text,
          speaker: s.speaker,
        }))
      }
      // 兜底（arch/05 §3.5）：上游没给时间戳，整块当一句话。
      const text = result.text.trim()
      if (text) {
        return [
          {
            startMs: Math.round(startS * 1000),
            endMs: Math.round(startS * 1000) + Math.max(1, result.durationS ?? 0) * 1000,
            text,
            speaker: null,
          },
        ]
      }
      return []
    } catch (err) {
      lastError = err
      const retryable = err instanceof AsrError ? err.retryable : true
      if (!retryable) break
      await delay(attempt * 2_000)
    }
  }
  throw new ProcessingError(
    `转写失败：${(lastError as Error)?.message ?? '未知错误'}`,
    {
      retryable: lastError instanceof AsrError ? lastError.retryable : true,
      code: lastError instanceof AsrError ? lastError.code : 'asr_failed',
    },
  )
}

/** 段落按时间重排成连续序号（单事务）。 */
async function renumberSegments(assetId: string): Promise<void> {
  const rows = await repo.listSegments(assetId)
  if (rows.length === 0) return
  const ordered = [...rows].sort((a, b) => a.start_ms - b.start_ms || a.seq - b.seq)
  await repo.renumber(ordered.map((row) => row.id))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { detectSilence }
