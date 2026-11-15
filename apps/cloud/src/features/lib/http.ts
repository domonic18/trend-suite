'use client'

import { getToken } from '@/features/accounts/session'

/** 浏览器侧统一错误：服务端错误体的 code + 静态文案（contracts 的 errorBody）。 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/** JSON 请求：自动带会话令牌，失败时抛 ApiError。 */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string }
    } | null
    throw new ApiError(
      body?.error?.message ?? `请求失败（${res.status}）`,
      res.status,
      body?.error?.code,
    )
  }
  return (await res.json()) as T
}
