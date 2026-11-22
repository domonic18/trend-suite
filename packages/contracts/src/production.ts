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
  /** 中文步名（服务端唯一口径——前端不再各写一份标签）。 */
  label: z.string().min(1),
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

/**
 * 停止点（教师端需求 T21）：教师点「停止制作」后，一眼看到停在哪。
 *
 * 停止是**步边界**安全中止：当前步跑完就停，已完成的步成果保留、
 * 回灌预算保留（attempts 不清零），改完可以继续。
 */
export const productionStopView = z.object({
  /** true = 确实停下了；false = 本来就没在跑（无需停止）。 */
  stopped: z.boolean(),
  sectionId: z.string().nullable(),
  sectionTitle: z.string().nullable(),
  /** 停下时所在的步序（1–9）；null = 还没开跑。 */
  step: z.number().int().min(1).max(9).nullable(),
  stepKey: z.string().nullable(),
  stepLabel: z.string().nullable(),
  at: z.string(),
})

export const productionBoardView = z.object({
  courseId: z.string().regex(idShape.course),
  sections: z.array(productionSectionRow),
  job: productionRunJobView.nullable(),
  /** 停止点：有值 = 当前处于「已停止」状态（成果保留，可继续）。 */
  stop: productionStopView.nullable(),
})

export const productionBoardResponse = z.object({ board: productionBoardView })

export const retryProductionSectionRequest = z.object({})

export const retryProductionSectionResponse = z.object({ ok: z.literal(true) })

export const stopProductionRequest = z.object({})

export const stopProductionResponse = z.object({
  ok: z.literal(true),
  stop: productionStopView,
})

export const resumeProductionRequest = z.object({})

export const resumeProductionResponse = z.object({ ok: z.literal(true) })

/**
 * Agent 事件流（制作页对话流）：教师看到「Agent 正在做什么」的依据。
 *
 * kind：
 * - step：步状态变化（开始 / 完成 / 失败回灌 / 挂起待人工）
 * - tool：一次模型调用（模型、耗时、token）——只记事实，不编造模型措辞
 * - stop：教师按下停止
 */
export const productionEventView = z.object({
  /** 事件 id（也是流游标）。 */
  id: z.string(),
  at: z.string(),
  kind: z.enum(['step', 'tool', 'stop']),
  sectionId: z.string().nullable(),
  sectionTitle: z.string().nullable(),
  step: z.number().int().min(1).max(9).nullable(),
  stepKey: z.string().nullable(),
  stepLabel: z.string().nullable(),
  /** 一句话说明（教师读的那句）。 */
  title: z.string(),
  detail: z.string().nullable(),
  /** step 事件的状态（running / done / failed / pending_manual）。 */
  status: z.string().nullable(),
  /** tool 事件：模型、耗时与 token。 */
  model: z.string().nullable(),
  latencyMs: z.number().nullable(),
  tokensIn: z.number().nullable(),
  tokensOut: z.number().nullable(),
})

export const productionStreamResponse = z.object({
  events: z.array(productionEventView),
  /** 增量游标：下次带回来只取新事件。 */
  cursor: z.string().nullable(),
  /** 当前是否处于已停止状态。 */
  stopped: z.boolean(),
  stop: productionStopView.nullable(),
})

export type ProductionTaskView = z.infer<typeof productionTaskView>
export type ProductionSectionRow = z.infer<typeof productionSectionRow>
export type ProductionRunJobView = z.infer<typeof productionRunJobView>
export type ProductionBoardView = z.infer<typeof productionBoardView>
export type ProductionBoardResponse = z.infer<typeof productionBoardResponse>
export type RetryProductionSectionResponse = z.infer<typeof retryProductionSectionResponse>
export type ProductionStopView = z.infer<typeof productionStopView>
export type StopProductionResponse = z.infer<typeof stopProductionResponse>
export type ResumeProductionResponse = z.infer<typeof resumeProductionResponse>
export type ProductionEventView = z.infer<typeof productionEventView>
export type ProductionStreamResponse = z.infer<typeof productionStreamResponse>
