import { z } from 'zod/v4'

/**
 * diagram 模板参数形状（arch/06 §3）：**唯一真相源**（zod/v4 子路径）。
 *
 * 一份定义两头用：
 * - 生产 agent 的图示草稿（figure-draft.ts）按它建模 → **模型看得见字段与取值域**，
 *   才不会把 `items` 写成对象、把 `leftCount` 写成字符串（端到端实测踩过：草稿 schema
 *   原本是 `record<string, unknown>`，形状只写在提示词散文里，模型看不见就乱填）。
 * - 服务端复检 + 渲染器按它把关（不合格 → params_schema_failed 回灌重写）。
 *
 * 用 zod/v4 而非 v3：agent 工具 schema 要喂给 langchain（与 widget-draft.ts 同理由）。
 */

/** 模板白名单（扩模板须同步给参数形状与渲染器）。 */
export const DIAGRAM_TEMPLATE_NAMES = [
  'chip-contrast',
  'chip-horizontal',
  'timeline',
  'stat-inline',
] as const
export type DiagramTemplateName = (typeof DIAGRAM_TEMPLATE_NAMES)[number]

export const chipContrastParams = z.strictObject({
  title: z.string().min(1).max(60),
  leftLabel: z.string().min(1).max(20),
  rightLabel: z.string().min(1).max(20),
  leftCount: z.number().int().min(4).max(24),
  rightCount: z.number().int().min(4).max(24),
})

export const chipHorizontalParams = z.strictObject({
  title: z.string().min(1).max(60),
  priceLabel: z.string().max(20).optional().default('价位'),
  rows: z
    .array(
      z.strictObject({
        /** 行位（0=底部，100=顶部）。 */
        y: z.number().int().min(0).max(100),
        /** 行宽占绘图区百分比。 */
        width: z.number().int().min(10).max(100),
        label: z.string().max(20).optional(),
      }),
    )
    .min(2)
    .max(12),
})

export const timelineParams = z.strictObject({
  title: z.string().min(1).max(60),
  events: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(30),
        desc: z.string().max(80).optional(),
      }),
    )
    .min(2)
    .max(8),
})

export const statInlineParams = z.strictObject({
  items: z
    .array(
      z.strictObject({
        label: z.string().min(1).max(20),
        value: z.string().min(1).max(12),
        note: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(4),
})

/** 模板 → 参数形状（服务端复检、渲染器、agent 草稿共用）。 */
export const diagramParamsByTemplate: Record<DiagramTemplateName, z.ZodType> = {
  'chip-contrast': chipContrastParams,
  'chip-horizontal': chipHorizontalParams,
  timeline: timelineParams,
  'stat-inline': statInlineParams,
}

/** 按模板名取参数形状；不在白名单内返回 null（调用方报 template_not_allowed）。 */
export function diagramParamsSchema(template: string): z.ZodType | null {
  return (diagramParamsByTemplate as Record<string, z.ZodType | undefined>)[template] ?? null
}
