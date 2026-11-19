import { z } from 'zod'

/**
 * 教材正文 DSL（arch/06 §2 口径）：Markdown 子集 + `:::` 容器块 + `[[…]]` 内联锚。
 * dslVersion 只增不减；解析器/校验器/渲染器三端共用本文件的形状与常量。
 */

export const DSL_VERSION = 1

/** v1 基础块（arch/06 §2.1）。 */
export const V1_DIRECTIVES = [
  'cards',
  'think',
  'sidenote',
  'warn',
  'board',
  'bignum',
  'cmp',
  'timeline',
  'figure',
  'clip',
] as const

/** v2 溯源块（依赖回放课件，迭代 7 启用）：低版本门禁直接拒。 */
export const V2_DIRECTIVES = ['annotation', 'replay'] as const

export type V1Directive = (typeof V1_DIRECTIVES)[number]
export type V2Directive = (typeof V2_DIRECTIVES)[number]

/** DSL 层每节配额（arch/06 §2.1），超出 `409 *_quota_exceeded`。 */
export const dslQuotas = { think: 3, sidenote: 8, cards: 2, figure: 8, clip: 3 } as const

/** 图示层配额（arch/05 §8）。 */
export const figureQuotas = { keyframe: 6, diagram: 2 } as const
export const generatedChapterMax = 3
export const generatedCourseMax = 24

/** 内联锚：`[[unit:su_xxx|原片 02:14]]` / `[[stock:600519|贵州茅台]]`。 */
export const dslInlineAnchor = z.object({
  kind: z.enum(['unit', 'stock']),
  ref: z.string().min(1),
  label: z.string().min(1),
  line: z.number().int().min(1),
})
export type DslInlineAnchor = z.infer<typeof dslInlineAnchor>

/** 容器块：指令 + 属性 + body 原文 + 起始行（issue 定位与预览下划线用）。 */
export const dslBlock = z.object({
  directive: z.string().min(1),
  attrs: z.record(z.string(), z.string()),
  body: z.string(),
  line: z.number().int().min(1),
})
export type DslBlock = z.infer<typeof dslBlock>

/** 解析产物：正文 = 散文段与容器块的平铺序列。 */
export const dslSegment = z.union([
  z.object({ type: z.literal('prose'), text: z.string(), line: z.number().int().min(1) }),
  z.object({ type: z.literal('block'), block: dslBlock }),
])
export type DslSegment = z.infer<typeof dslSegment>

export const dslAst = z.object({
  version: z.number().int().min(1),
  segments: z.array(dslSegment),
  anchors: z.array(dslInlineAnchor),
})
export type DslAst = z.infer<typeof dslAst>

/**
 * DSL 校验问题（第 2 层语义校验，arch/06 §2.4）：issue 必须带位置，
 * 术语违例带词与最近似建议——「被拦并说明原因」的载体。
 */
export const dslErrorCode = z.enum([
  'figure_ref_unknown',
  'unit_ref_unknown',
  'unit_anchor_unknown',
  'clip_not_grounded',
  'stock_not_in_list',
  'term_not_in_concepts',
  'sec_not_grounded',
  'figure_not_grounded',
  'template_not_allowed',
  'params_schema_failed',
  'directive_not_in_version',
  'body_schema_failed',
  'figure_quota_exceeded',
  'keyframe_quota_exceeded',
  'diagram_quota_exceeded',
  'generated_quota_exceeded',
  'think_quota_exceeded',
  'sidenote_quota_exceeded',
  'cards_quota_exceeded',
  'clip_quota_exceeded',
])

export const dslIssue = z.object({
  code: dslErrorCode,
  message: z.string().min(1),
  line: z.number().int().min(1).nullable(),
  term: z.string().optional(),
  suggestion: z.string().optional(),
})
export type DslIssue = z.infer<typeof dslIssue>
