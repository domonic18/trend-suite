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
  // 模型未配置：对应阶段不可用（arch/07 §9.1「缺失行为」）。
  'model_not_configured',
  // 素材加工终态失败（arch/05 §3.8）。
  'processing_failed',
  // 课程方案门禁（arch/05 §5 阶段三）。
  // concept_conflict：同课程概念重名（验收尺子 409）。
  'concept_conflict',
  // outline_violation：微调新增目录外章节等目录先验违例。
  'outline_violation',
  // plan_not_draftable：素材未就绪 / 已有方案占用等不可触发起草。
  'plan_not_draftable',
  // plan_unresolved：存在未决项（低匹配分节 / 拒绝记录）时批准被挡。
  'plan_unresolved',
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
