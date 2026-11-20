import { z } from 'zod'
import { idShape } from './ids.js'
import { DIAGRAM_TEMPLATE_NAMES } from './figure-params.js'

/**
 * 图示三路（arch/05 §8 / arch/06 §3）：keyframe 讲师原始画面（按 source unit
 * 时间戳取帧）、diagram 确定性 SVG 模板图、generated 文生图（仅装饰，
 * 禁止承载教学信息）。配额：keyframe ≤6/节、diagram ≤2/节、generated 章≤3 课≤24。
 */

export const figureKind = z.enum(['keyframe', 'diagram', 'generated'])
export type FigureKind = z.infer<typeof figureKind>

/** diagram 模板白名单 v1（arch/06 §3）：扩模板需冻结版本并同步渲染器。 */
export const diagramTemplate = z.enum(DIAGRAM_TEMPLATE_NAMES)
export type DiagramTemplate = z.infer<typeof diagramTemplate>

export const figureView = z.object({
  id: z.string().regex(idShape.figure),
  /** 课程内大纲展示号（如 '1-1'），与 productionBoardView.sectionId 同口径。 */
  sectionId: z.string().min(1),
  kind: figureKind,
  caption: z.string().min(1),
  unitId: z.string().nullable(),
  assetId: z.string().nullable(),
  /** keyframe 取帧秒（落所引 unit 窗内）；其余恒 null。 */
  sec: z.number().nullable(),
  template: diagramTemplate.nullable(),
  params: z.record(z.string(), z.unknown()).nullable(),
  /** diagram 服务端确定性渲好的 SVG 原文。 */
  svg: z.string().nullable(),
  /** keyframe 帧图 / generated 成图的短时签名 URL；diagram 恒 null。 */
  url: z.string().nullable(),
  /** generated 的生成提示词（审计）。 */
  prompt: z.string().nullable(),
})
export type FigureView = z.infer<typeof figureView>

export const figureListResponse = z.object({ figures: z.array(figureView) })
export type FigureListResponse = z.infer<typeof figureListResponse>
