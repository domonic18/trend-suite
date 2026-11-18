import 'server-only'

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
