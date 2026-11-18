'use client'

import {
  cancelMaterialResponse,
  createMediaAssetResponse,
  ingestResponse,
  mediaAssetListResponse,
  mediaAssetView,
  mediaFrameListResponse,
  transcriptResponse,
  type IngestResponse,
  type MediaAssetView,
  type MediaFrameListResponse,
  type MediaUploadTarget,
  type TranscriptResponse,
} from '@trend-suite/contracts'
import { getToken } from '@/features/accounts/session'
import { ApiError, apiRequest } from '@/features/lib/http'

export async function listAssets(courseId: string): Promise<MediaAssetView[]> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets?courseId=${encodeURIComponent(courseId)}`,
  )
  return mediaAssetListResponse.parse(data).items
}

/** 触发加工（force=true 清旧产物重跑）。 */
export async function ingestAsset(assetId: string, force = false): Promise<IngestResponse> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}/ingest`,
    { method: 'POST', body: JSON.stringify({ force }) },
  )
  return ingestResponse.parse(data)
}

/** 重试失败的任务：只补没做完的部分。 */
export async function retryAsset(assetId: string): Promise<IngestResponse> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}/retry`,
    { method: 'POST' },
  )
  return ingestResponse.parse(data)
}

/** 停止加工（T19）：排队中直接取消；运行中在阶段边界安全中止。 */
export async function cancelMaterial(assetId: string): Promise<MediaAssetView> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}/cancel`,
    { method: 'POST' },
  )
  return cancelMaterialResponse.parse(data).asset
}

/** 删除素材（T20）：行、段落、关键帧与已落盘字节一并清理。 */
export async function deleteMaterial(assetId: string): Promise<void> {
  await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  )
}

/** 逐字稿：转写进行中也返回已落库的段落。 */
export async function getTranscript(assetId: string): Promise<TranscriptResponse> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}/transcript`,
  )
  return transcriptResponse.parse(data)
}

/** 关键帧列表。 */
export async function getFrames(assetId: string): Promise<MediaFrameListResponse> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets/${encodeURIComponent(assetId)}/frames`,
  )
  return mediaFrameListResponse.parse(data)
}

export async function createAsset(
  courseId: string,
  fileName: string,
  byteSize: number,
): Promise<{ asset: MediaAssetView; upload: MediaUploadTarget }> {
  const data = await apiRequest<unknown>('/v1/admin/content/media-assets', {
    method: 'POST',
    body: JSON.stringify({ courseId, fileName, byteSize }),
  })
  return createMediaAssetResponse.parse(data)
}

/**
 * 直传：XHR 而非 fetch——只有 XHR 有上传进度事件（教师端需求 T4「进度可见」）。
 * 字节直送目标地址，不经应用内存中转。
 */
export function uploadToTarget(input: {
  target: MediaUploadTarget
  file: File
  onProgress: (loaded: number, total: number) => void
}): Promise<MediaAssetView> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', new URL(input.target.url, window.location.origin).toString(), true)
    const token = getToken()
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
    for (const [name, value] of Object.entries(input.target.headers)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded, event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(mediaAssetView.parse(JSON.parse(xhr.responseText)))
        } catch {
          reject(new ApiError('上传响应无法解析', xhr.status))
        }
        return
      }
      let message = `上传失败（${xhr.status}）`
      let code: string | undefined
      try {
        const body = JSON.parse(xhr.responseText) as {
          error?: { code?: string; message?: string }
        }
        message = body?.error?.message ?? message
        code = body?.error?.code
      } catch {
        /* 非 JSON 错误体：用状态码兜底 */
      }
      reject(new ApiError(message, xhr.status, code))
    }
    xhr.onerror = () => reject(new ApiError('上传中断，请重试', 0))
    xhr.onabort = () => reject(new ApiError('上传已取消', 0))
    xhr.send(input.file)
  })
}
