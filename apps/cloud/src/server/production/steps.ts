import 'server-only'
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_TOKENS } from './channel'

/**
 * 九步定义（arch/05 §6）：固定顺序、跑错序被挡。
 * kind：agent = deepagents 子代理 + 我们的通道；pure = 确定性纯函数（不走模型）。
 * taskKey = ai_runs 记账与运营台绑定的任务键；pure 步为 null。
 */

export type StepDef = {
  n: number
  key: string
  label: string
  taskKey: string | null
  kind: 'agent' | 'pure'
}

export const STEP_DEFS: readonly StepDef[] = [
  { n: 1, key: 'case_stocks', label: '案例股', taskKey: 'content.case_stocks', kind: 'agent' },
  { n: 2, key: 'market_sync', label: '行情同步', taskKey: null, kind: 'pure' },
  { n: 3, key: 'market_readback', label: '行情读回', taskKey: null, kind: 'pure' },
  { n: 4, key: 'figure_spec', label: '图示', taskKey: 'content.figure_spec', kind: 'agent' },
  { n: 5, key: 'replay_widget', label: '回放课件', taskKey: 'content.widget_spec', kind: 'agent' },
  { n: 6, key: 'section_draft', label: '正文', taskKey: 'content.section_draft', kind: 'agent' },
  { n: 7, key: 'widgets', label: '其余课件', taskKey: 'content.widget_spec', kind: 'agent' },
  { n: 8, key: 'review', label: '评审', taskKey: 'rubric_review', kind: 'agent' },
  { n: 9, key: 'provenance', label: '溯源', taskKey: null, kind: 'pure' },
] as const

export const STEP_COUNT = STEP_DEFS.length

/**
 * 各 agent 步的输出预算（token）。
 *
 * 推理型模型（M3.1-Flash）的思考与正文共用 max_tokens 预算：通道的 4K 默认会被
 * 思考吃光，正文直接截断成 llm_truncated——九步第一次真跑就卡在第 1 步「案例股」。
 * 与目录代拟（12K）、课程方案起草（32K）、素材理解（12K）同一量级口径：
 * 步内产物越大、证据工具往返越多，预算给得越多。
 *
 * 预算按**实测峰值**定，不按感觉：预发实跑记录到 content.widget_spec 单次输出
 * 峰值 15727 token（16K 预算的天花板，第 5 步回放课件因此被截断）、
 * content.section_draft 峰值 12791——两大产物步都贴着天花板，故给到 32K。
 */
const STEP_MAX_TOKENS: Record<string, number> = {
  case_stocks: 12_000,
  figure_spec: 12_000,
  replay_widget: 32_000,
  widgets: 32_000,
  section_draft: 32_000,
  review: 8_000,
}

/** 该步的输出预算；未登记的步用通道默认（纯函数步本就不调模型）。 */
export function stepMaxTokens(key: string): number {
  return STEP_MAX_TOKENS[key] ?? DEFAULT_MAX_TOKENS
}

/**
 * 各 agent 步的单次调用超时（ms）。
 *
 * 通道默认 120s 是给「一问一答」定的；正文步要写 1200~3000 字并来回查证据工具，
 * 一次请求远跑不完 120s → llm_timeout，三次回灌后转人工（端到端实测）。
 * 与输出预算同口径：**产物越大的步越慢**。
 */
const STEP_TIMEOUT_MS: Record<string, number> = {
  section_draft: 600_000,
  replay_widget: 300_000,
  widgets: 300_000,
  figure_spec: 300_000,
  case_stocks: 240_000,
  review: 180_000,
}

/** 该步的单次调用超时；未登记的步用通道默认。 */
export function stepTimeoutMs(key: string): number {
  return STEP_TIMEOUT_MS[key] ?? DEFAULT_CALL_TIMEOUT_MS
}

/** 批准方案后自动起跑的 job 类型（pipeline_jobs.kind）。 */
export const PRODUCTION_RUN_JOB_KIND = 'production_run'

export function stepDef(step: number): StepDef {
  const def = STEP_DEFS.find((entry) => entry.n === step)
  if (!def) throw new Error(`未知步骤：${step}`)
  return def
}

export function stepKey(step: number): string {
  return stepDef(step).key
}

export function stepLabel(step: number): string {
  return stepDef(step).label
}
