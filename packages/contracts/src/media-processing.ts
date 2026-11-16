import { z } from 'zod'
import { idShape } from './ids.js'

/**
 * 素材加工（arch/05 §3.4–§3.7）：抽音频 → ASR 转写 → 关键帧 → 索引。
 * 加工产物对教师可见、可读、可重试；未完成的内容显式标 partial。
 */

/** 加工阶段（运营台原型 teacher-material 的流水线步进条）。 */
export const processingSteps = ['uploaded', 'audio', 'transcribe', 'frames', 'index', 'done'] as const
export const processingStep = z.enum(processingSteps)

/** 加工任务状态（arch/02 §4 的队列状态机）。 */
export const jobStatuses = ['queued', 'running', 'succeeded', 'failed', 'canceled'] as const
export const jobStatus = z.enum(jobStatuses)

/** 一段可读转写：转写进行中先落 partial=true 的段落。 */
export const transcriptSegmentView = z.object({
  id: z.string().regex(idShape.transcriptSegment),
  assetId: z.string(),
  seq: z.number(),
  startMs: z.number(),
  endMs: z.number(),
  speaker: z.string().nullable(),
  text: z.string(),
  /** 理解 Agent 产出的 source unit 归属：迭代 2 之前为 null。 */
  unitId: z.string().nullable(),
  /** true = 还在转写中，这段不能作为大纲锁定依据。 */
  partial: z.boolean(),
})

export const transcriptResponse = z.object({
  assetId: z.string(),
  /** 全部段落已定稿（转写完成）为 true。 */
  complete: z.boolean(),
  segments: z.array(transcriptSegmentView),
})

export const mediaFrameView = z.object({
  id: z.string().regex(idShape.mediaFrame),
  assetId: z.string(),
  atMs: z.number(),
  /** 短时签名地址（本地模式下是应用自身的取图路由）。 */
  url: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  caption: z.string().nullable(),
})

export const mediaFrameListResponse = z.object({ items: z.array(mediaFrameView) })

export type ProcessingStep = z.infer<typeof processingStep>
export type JobStatus = z.infer<typeof jobStatus>
export type TranscriptSegmentView = z.infer<typeof transcriptSegmentView>
export type TranscriptResponse = z.infer<typeof transcriptResponse>
export type MediaFrameView = z.infer<typeof mediaFrameView>
export type MediaFrameListResponse = z.infer<typeof mediaFrameListResponse>
