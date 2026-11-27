import { z } from 'zod/v4'
import {
  chipContrastParams,
  chipHorizontalParams,
  statInlineParams,
  timelineParams,
} from './figure-params'

/**
 * 图示**草稿**契约（arch/05 §8，zod/v4 子路径）：生产 agent 交给 write_step_output 的形状。
 *
 * 与 figure-params.ts 的关系：草稿里 diagram 的 params **就是**模板参数形状本身
 * （不是 record<string, unknown>）——模型看得见每个字段与取值域，就不会把
 * `items` 写成对象、把 `leftCount` 写成字符串（端到端实测踩过：形状只写在提示词
 * 散文里，草稿 schema 是自由键值对，模型看不见就乱填，服务端复检必然拒绝）。
 *
 * 模板与参数形状一一对应，故用四个 template 字面量的分支而非「template + 自由 params」。
 */

const caption = z.string().min(1).max(80)
const unitId = z.string().regex(/^su_[0-9a-f]{16}$/)

const keyframeDraft = z.strictObject({
  kind: z.literal('keyframe'),
  caption,
  /** 证据锚：素材单元 id（不可编造，服务端复检会查存在性）。 */
  unitId,
  /** 取帧秒（落单元窗内）；缺省取单元中点。 */
  secHint: z.number().int().min(0).optional(),
})

const generatedDraft = z.strictObject({
  kind: z.literal('generated'),
  caption,
  /** 画面描述（装饰图，禁止承载教学信息）。 */
  prompt: z.string().min(1).max(500),
})

const diagramBase = {
  kind: z.literal('diagram'),
  caption,
  unitId: unitId.optional(),
}

export const figureDraft = z.union([
  keyframeDraft,
  generatedDraft,
  z.strictObject({
    ...diagramBase,
    template: z.literal('chip-contrast'),
    params: chipContrastParams,
  }),
  z.strictObject({
    ...diagramBase,
    template: z.literal('chip-horizontal'),
    params: chipHorizontalParams,
  }),
  z.strictObject({
    ...diagramBase,
    template: z.literal('timeline'),
    params: timelineParams,
  }),
  z.strictObject({
    ...diagramBase,
    template: z.literal('stat-inline'),
    params: statInlineParams,
  }),
])
export type FigureDraft = z.infer<typeof figureDraft>

/** 步骤 4 产物：图示规格数组。 */
export const figureDraftProduct = z.object({
  figures: z.array(figureDraft).min(1).max(10),
})
export type FigureDraftProduct = z.infer<typeof figureDraftProduct>
