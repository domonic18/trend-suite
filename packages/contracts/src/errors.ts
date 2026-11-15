import { z } from 'zod'

/**
 * 错误语义（arch/01 §2.4）：schema 校验失败返回**首个问题**（firstIssue），
 * 前端据此高亮第一个出错字段——不返回错误数组。
 */
export const errorCodes = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'invalid_credentials',
  'too_many_requests',
  'payload_too_large',
  'unsupported_media_type',
  'unprocessable_media',
  'internal_error',
] as const

export const errorCode = z.enum(errorCodes)

export const firstIssue = z.object({
  path: z.string(),
  message: z.string(),
})

export const errorBody = z.object({
  error: z.object({
    code: errorCode,
    message: z.string(),
    firstIssue: firstIssue.optional(),
  }),
})

export type ErrorCode = (typeof errorCodes)[number]
export type FirstIssue = z.infer<typeof firstIssue>
