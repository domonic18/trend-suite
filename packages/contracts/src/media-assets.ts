import { z } from 'zod'
import { mediaAssetStatus } from './enums.js'
import { idShape } from './ids.js'

/** 单文件上限 2GiB（教师端需求 T4 / arch/05 §3.1）。 */
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024

/** 直传凭据有效期：15 分钟，够传大文件又不至于长期有效。 */
export const MEDIA_UPLOAD_TTL_SECONDS = 15 * 60

export const createMediaAssetRequest = z.object({
  courseId: z.string().regex(idShape.course, '课程 ID 不合法'),
  fileName: z.string().min(1, '文件名必填').max(255, '文件名最长 255 个字符'),
  byteSize: z
    .number()
    .int('文件大小必须为整数')
    .positive('文件大小必须为正数')
    .max(MAX_MEDIA_BYTES, `单文件不得超过 2GiB（${MAX_MEDIA_BYTES} 字节）`),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 必须是 64 位小写 hex').optional(),
})

export const mediaAssetView = z.object({
  id: z.string().regex(idShape.mediaAsset),
  courseId: z.string(),
  fileName: z.string(),
  status: mediaAssetStatus,
  byteSize: z.number().nullable(),
  sha256: z.string().nullable(),
  durationS: z.number().nullable(),
  videoOk: z.boolean(),
  audioOk: z.boolean(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
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

export const mediaAssetListResponse = z.object({ items: z.array(mediaAssetView) })

export type CreateMediaAssetRequest = z.infer<typeof createMediaAssetRequest>
export type MediaAssetView = z.infer<typeof mediaAssetView>
export type MediaUploadTarget = z.infer<typeof mediaUploadTarget>
export type CreateMediaAssetResponse = z.infer<typeof createMediaAssetResponse>
export type MediaAssetListResponse = z.infer<typeof mediaAssetListResponse>
