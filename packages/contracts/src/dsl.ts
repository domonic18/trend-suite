import { z } from 'zod'

/**
 * 教材正文 DSL（arch/06 §2 口径）：Markdown 子集 + `:::` 容器块 + `[[…]]` 内联锚。
 * dslVersion 只增不减；解析器/校验器/渲染器三端共用本文件的形状与常量。
 */

export const DSL_VERSION = 2

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

/** v2 溯源块（依赖回放课件，迭代 7 启用）：v1 版本正文见到即拒。 */
export const V2_DIRECTIVES = ['annotation', 'replay'] as const

export type V1Directive = (typeof V1_DIRECTIVES)[number]
export type V2Directive = (typeof V2_DIRECTIVES)[number]

/** 指令的最低 DSL 版本（版本只增不减，v1 指令全版本可用）。 */
export const DIRECTIVE_MIN_VERSION: Record<string, number> = {
  ...Object.fromEntries(V1_DIRECTIVES.map((name) => [name, 1])),
  ...Object.fromEntries(V2_DIRECTIVES.map((name) => [name, 2])),
}

/** 某指令在某版本是否可用（渲染器与校验器共用同一份版本门禁）。 */
export function directiveAllowedInVersion(directive: string, version: number): boolean {
  const min = DIRECTIVE_MIN_VERSION[directive]
  return min !== undefined && version >= min
}

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

/**
 * JSON 容器块的 body 形状（arch/06 §2.1）：校验器与渲染器共用同一份——
 * 两边各写一套字段名，必然出现「服务端判过、客户端渲染不出」的漂移。
 */
export const dslCardsBody = z.object({
  items: z
    .array(z.object({ num: z.string().optional(), title: z.string(), desc: z.string().optional() }))
    .min(1)
    .max(4),
})
export type DslCardsBody = z.infer<typeof dslCardsBody>

export const dslBignumBody = z.object({
  items: z
    .array(z.object({ label: z.string(), value: z.string(), note: z.string().optional() }))
    .min(1)
    .max(3),
})
export type DslBignumBody = z.infer<typeof dslBignumBody>

export const dslCmpSide = z.object({ head: z.string(), items: z.array(z.string()) })

export const dslCmpBody = z.object({
  title: z.string().optional(),
  left: dslCmpSide,
  right: dslCmpSide,
})
export type DslCmpBody = z.infer<typeof dslCmpBody>

export const dslTimelineBody = z.object({
  events: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string(),
        desc: z.string().optional(),
      }),
    )
    .min(3)
    .max(8),
})
export type DslTimelineBody = z.infer<typeof dslTimelineBody>

/**
 * v2 溯源块 :::annotation 的 body（arch/06 §2.2）：
 * d = 标注所在的**交易日期**（不是 bar 索引——索引会随回填/裁剪漂移，日期是稳定锚点）、
 * label = 标注说明、quote = 老师原话、glossary = 本条涉及的术语（须 ∈ 概念表）。
 */
export const dslAnnotationBody = z.object({
  d: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().min(1).max(200),
  quote: z.string().min(1).max(2000),
  glossary: z.array(z.string().min(1).max(200)).min(1).max(10),
})
export type DslAnnotationBody = z.infer<typeof dslAnnotationBody>

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
  'annotation_not_grounded',
  'annotation_date_out_of_window',
  'annotation_date_not_trading_day',
  'annotation_term_unknown',
  'replay_widget_unknown',
  'replay_widget_ambiguous',
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
