import { z } from 'zod'
import type { ErrorCode, FirstIssue } from '@trend-suite/contracts'

/** 领域错误 → HTTP 映射的唯一出口（路由层只做映射，不写业务分支）。 */
export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly firstIssue: FirstIssue | undefined

  constructor(status: number, code: ErrorCode, message: string, firstIssue?: FirstIssue) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.firstIssue = firstIssue
  }
}

export const badRequest = (message: string, firstIssue?: FirstIssue) =>
  new HttpError(400, 'invalid_request', message, firstIssue)

export const unauthenticated = (message = '请先登录') =>
  new HttpError(401, 'unauthenticated', message)

export const invalidCredentials = (message = '用户名或口令不正确') =>
  new HttpError(401, 'invalid_credentials', message)

export const forbidden = (message = '当前角色无权执行该操作') =>
  new HttpError(403, 'forbidden', message)

export const notFound = (message = '资源不存在') =>
  new HttpError(404, 'not_found', message)

export const conflict = (message: string) => new HttpError(409, 'conflict', message)

export const tooManyRequests = (message = '操作过于频繁，请稍后再试') =>
  new HttpError(429, 'too_many_requests', message)

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}

/** schema 校验失败只给首个问题（arch/01 §2.4），前端据此高亮第一个出错字段。 */
export function firstIssueOf(error: z.ZodError): FirstIssue {
  const issue = error.issues[0]
  return { path: issue?.path.join('.') ?? '', message: issue?.message ?? '参数不合法' }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const error: { code: ErrorCode; message: string; firstIssue?: FirstIssue } = {
      code: err.code,
      message: err.message,
    }
    if (err.firstIssue) error.firstIssue = err.firstIssue
    return json({ error }, err.status)
  }
  if (err instanceof z.ZodError) {
    return json(
      { error: { code: 'invalid_request', message: '参数不合法', firstIssue: firstIssueOf(err) } },
      400,
    )
  }
  console.error('[http] 未预期的错误', err)
  return json({ error: { code: 'internal_error', message: '服务内部错误' } }, 500)
}
