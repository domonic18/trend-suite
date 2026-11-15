'use client'

import {
  createMediaAssetResponse,
  mediaAssetListResponse,
  mediaAssetView,
  type MediaAssetView,
  type MediaUploadTarget,
} from '@trend-suite/contracts'
import { getToken } from '@/features/accounts/session'
import { ApiError, apiRequest } from '@/features/lib/http'

export async function listAssets(courseId: string): Promise<MediaAssetView[]> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/media-assets?courseId=${encodeURIComponent(courseId)}`,
  )
  return mediaAssetListResponse.parse(data).items
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
