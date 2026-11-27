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
      error?: { code?: string; message?: string; firstIssue?: { path?: string; message?: string } }
    } | null
    // 参数校验失败时把具体字段错误透传给用户（只给首个问题，arch/01 §2.4），
    // 不再只显示笼统的「参数不合法」。
    const detail = body?.error?.firstIssue?.message
    throw new ApiError(
      detail ? `${body?.error?.message}：${detail}` : (body?.error?.message ?? `请求失败（${res.status}）`),
      res.status,
      body?.error?.code,
    )
  }
  // 成功响应的 body 可能为空（204 No Content——删除等操作）：无 body 时返回
  // undefined 而不是无脑 res.json()（空 body 解析会抛 SyntaxError，
  // 把删除成功当失败——「删除失败：Unexpected end of JSON input」的根因）。
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}
