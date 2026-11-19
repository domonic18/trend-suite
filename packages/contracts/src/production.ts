import { z } from 'zod'
import { idShape } from './ids.js'
import { productionSectionStatus, productionTaskStatus } from './enums.js'
import { sectionContentBodyStatus } from './content.js'

/**
 * 逐节九步生产引擎（arch/05 §6，教师端需求 T10）：
 * 批准方案后自动起跑，确定性状态机强制九步顺序；断点续跑、
 * 失败回灌（≤3）超限转人工待办，绝不部分落库（对外只认 complete 节）。
 */

export const productionTaskView = z.object({
  step: z.number().int().min(1).max(9),
  /** 步骤键（如 case_stocks / section_draft），前端用它映射中文标签与配色。 */
  key: z.string().min(1),
  status: productionTaskStatus,
  attempts: z.number().int().min(0),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
})

export const productionSectionRow = z.object({
  /** outline 骨架节点 id（目录节，非 lesson）。 */
  sectionId: z.string().min(1),
  title: z.string(),
  order: z.number().int().min(0),
  status: productionSectionStatus,
  /** 产出计数 = done 步数（九步全过即 9）。 */
  products: z.number().int().min(0).max(9),
  /** 正文校验态（none 未产出 / draft 已过复检落库可预览）。 */
  bodyStatus: sectionContentBodyStatus,
  tasks: z.array(productionTaskView).min(1).max(9),
})

export const productionRunJobView = z.object({
  id: z.string().regex(idShape.pipelineJob),
  courseId: z.string().regex(idShape.course),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  attempts: z.number().int().min(0),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  updatedAt: z.string(),
})

export const productionBoardView = z.object({
  courseId: z.string().regex(idShape.course),
  sections: z.array(productionSectionRow),
  job: productionRunJobView.nullable(),
})

export const productionBoardResponse = z.object({ board: productionBoardView })

export const retryProductionSectionRequest = z.object({})

export const retryProductionSectionResponse = z.object({ ok: z.literal(true) })

export type ProductionTaskView = z.infer<typeof productionTaskView>
export type ProductionSectionRow = z.infer<typeof productionSectionRow>
export type ProductionRunJobView = z.infer<typeof productionRunJobView>
export type ProductionBoardView = z.infer<typeof productionBoardView>
export type ProductionBoardResponse = z.infer<typeof productionBoardResponse>
export type RetryProductionSectionResponse = z.infer<typeof retryProductionSectionResponse>
