import { z } from 'zod'
import { mediaAssetStatus } from './enums.js'
import { idShape } from './ids.js'
import { jobStatus, processingStep } from './media-processing.js'

/** 单文件上限 2GiB（教师端需求 T4 / arch/05 §3.1）。 */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024

/** 直传凭据有效期：15 分钟，够传大文件又不至于长期有效。 */
export const MEDIA_UPLOAD_TTL_SECONDS = 15 * 60

export const createMediaAssetRequest = z.object({
  /** 可空：素材独立上传入库（归属关系在建课勾选时建立）；沿用旧行为仍可传。 */
  courseId: z.string().regex(idShape.course, '课程 ID 不合法').optional(),
  fileName: z.string().min(1, '文件名必填').max(255, '文件名最长 255 个字符'),
  byteSize: z
    .number()
    .int('文件大小必须为整数')
    .positive('文件大小必须为正数')
    .max(MAX_MEDIA_BYTES, `单文件不得超过 2GiB（${MAX_MEDIA_BYTES} 字节）`),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 必须是 64 位小写 hex').optional(),
})

/**
 * 素材分析三段（教师端需求 T4/T4b）：逐字稿 / 关键帧 / 视频理解。
 * 三段各自可单独重跑、单独删除结果——删一段不动素材字节，也不影响其他两段。
 */
export const mediaStages = ['transcript', 'frames', 'understanding'] as const
export const mediaStage = z.enum(mediaStages)

/** 段落态：空（未产出）/ 进行中 / 已完成 / 部分完成 / 失败。 */
export const mediaStageStatuses = ['empty', 'running', 'done', 'partial', 'failed'] as const
export const mediaStageStatus = z.enum(mediaStageStatuses)

export const mediaAssetStageView = z.object({
  stage: mediaStage,
  status: mediaStageStatus,
  /** 该段产物条数：逐字稿段数 / 关键帧张数 / 理解单元数。 */
  count: z.number(),
  updatedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
})

export const mediaAssetView = z.object({
  id: z.string().regex(idShape.mediaAsset),
  /** 可空：独立上传的素材还没归属任何课程。 */
  courseId: z.string().nullable(),
  /** 归属课程标题：素材库是跨课程的全局视角；未归属课程时为 null。 */
  courseTitle: z.string().nullable(),
  fileName: z.string(),
  status: mediaAssetStatus,
  byteSize: z.number().nullable(),
  sha256: z.string().nullable(),
  durationS: z.number().nullable(),
  videoOk: z.boolean(),
  audioOk: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  // 加工进度（arch/05 §3.7）：阶段、百分比、当前提示、队列状态。
  processStep: processingStep,
  processProgress: z.number(),
  processMessage: z.string().nullable(),
  jobStatus: jobStatus.nullable(),
  segmentCount: z.number(),
  frameCount: z.number(),
  /** 三段分析各自的产出与状态。 */
  stages: z.array(mediaAssetStageView),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** 直传目标：浏览器 PUT 字节到此地址（本地模式是应用路由，COS 模式是预签名地址）。 */
export const mediaUploadTarget = z.object({
  method: z.literal('PUT'),
  url: z.string(),
  headers: z.record(z.string()),
  expiresAt: z.string(),
})

export const createMediaAssetResponse = z.object({
  asset: mediaAssetView,
  upload: mediaUploadTarget,
})

/** 理解单元：视频理解段的产物——教师核对「这一条出自原视频哪几分钟」。 */
export const mediaUnderstandingItem = z.object({
  id: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
  teachingPoints: z.array(z.string()),
})

export const mediaUnderstandingResponse = z.object({ items: z.array(mediaUnderstandingItem) })

export const mediaAssetListResponse = z.object({ items: z.array(mediaAssetView) })

/** 触发加工（重新转写 / 重试失败）：force=true 时清掉旧产物重跑。 */
export const ingestRequest = z.object({
  force: z.boolean().optional(),
})

export const ingestResponse = z.object({
  asset: mediaAssetView,
  jobId: z.string(),
})

/** 停止加工（T19）：任务取消、素材回「已上传」态，已转产物保留。 */
export const cancelMaterialResponse = z.object({
  asset: mediaAssetView,
})

/** 删除素材（T20）：行、段落、关键帧、字节一并清理。 */
export const deleteMaterialResponse = z.object({
  deleted: z.literal(true),
})

/**
 * 重跑某一段分析：
 * - force 缺省或 false → 只补缺口（按块去重，不重复计费）；
 * - force=true → 先清掉该段已有结果再重新生成。
 */
export const rerunMediaStageRequest = z.object({
  force: z.boolean().optional(),
})

export const rerunMediaStageResponse = z.object({
  asset: mediaAssetView,
  jobId: z.string(),
})

/** 删除某一段的结果：素材字节与另外两段不受影响。 */
export const deleteMediaStageResponse = z.object({
  asset: mediaAssetView,
})

export type CreateMediaAssetRequest = z.infer<typeof createMediaAssetRequest>
export type MediaAssetView = z.infer<typeof mediaAssetView>
export type MediaUploadTarget = z.infer<typeof mediaUploadTarget>
export type CreateMediaAssetResponse = z.infer<typeof createMediaAssetResponse>
export type MediaAssetListResponse = z.infer<typeof mediaAssetListResponse>
export type MediaUnderstandingItem = z.infer<typeof mediaUnderstandingItem>
export type MediaUnderstandingResponse = z.infer<typeof mediaUnderstandingResponse>
export type IngestRequest = z.infer<typeof ingestRequest>
export type IngestResponse = z.infer<typeof ingestResponse>
export type CancelMaterialResponse = z.infer<typeof cancelMaterialResponse>
export type DeleteMaterialResponse = z.infer<typeof deleteMaterialResponse>
export type MediaStage = z.infer<typeof mediaStage>
export type MediaStageStatus = z.infer<typeof mediaStageStatus>
export type MediaAssetStageView = z.infer<typeof mediaAssetStageView>
export type RerunMediaStageRequest = z.infer<typeof rerunMediaStageRequest>
export type RerunMediaStageResponse = z.infer<typeof rerunMediaStageResponse>
export type DeleteMediaStageResponse = z.infer<typeof deleteMediaStageResponse>
