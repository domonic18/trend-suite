import {
  atr,
  calcFormula,
  classifyShape,
  generateBars,
  type Generator,
  type KlineBar,
  type WidgetBar,
  type WidgetSpec,
} from '@trend-suite/contracts'

/**
 * 课件的视图模型与判题逻辑（arch/06 §10）：**纯函数、无 React**——
 * React DOM 测试在本仓不可行（react-server 条件下无 useEffect），
 * 故一切「怎么判、怎么算、怎么排」都抽到这里，可脱离浏览器单测；
 * 交互组件只留薄状态。
 *
 * 数值口径与服务端断言证明器同源（atr / calcFormula / generateBars 都取自
 * 契约包 widget-data.ts）：客户端的即时反馈与服务端的入库判据不会各说一套。
 */

export type Verdict = {
  correct: boolean
  answerText: string
  explain: string
}

/** mcq-quiz 判题（选项有 id，答案 answerId）。 */
export function mcqVerdict(spec: WidgetSpec, selectedId: string | null): Verdict | null {
  if (spec.type !== 'mcq-quiz' || !selectedId) return null
  const answer = spec.options.find((option) => option.id === spec.answerId)
  const correct = selectedId === spec.answerId
  return {
    correct,
    answerText: answer?.label ?? '',
    explain: correct ? '答对了' : '再看看选项之间的差别',
  }
}

export type PatternOptionView = {
  id: string
  label: string
  bars: WidgetBar[]
  shape: Generator
}

/** pattern-quiz 各选项的合成 K 线与实际形态（形态由 bars 归类，不看声明值）。 */
export function patternOptionViews(spec: WidgetSpec): PatternOptionView[] {
  if (spec.type !== 'pattern-quiz') return []
  return spec.options.map((option) => {
    const generator = option.generator ?? spec.data.generator
    const seed = option.seed ?? spec.data.seed
    const count = option.bars ?? spec.data.bars
    const bars = generateBars(generator, seed, count)
    return { id: option.id, label: option.label, bars, shape: classifyShape(bars) }
  })
}

/** pattern-quiz 判题（答案项 id）。 */
export function patternVerdict(spec: WidgetSpec, selectedId: string | null): Verdict | null {
  if (spec.type !== 'pattern-quiz' || !selectedId) return null
  const answer = spec.options.find((option) => option.id === spec.answerId)
  const correct = selectedId === spec.answerId
  return {
    correct,
    answerText: answer?.label ?? '',
    explain: correct ? '形态识别正确' : '这条走势不是题目要的那个形态',
  }
}

export type AnnotatorCheck = {
  name: string
  ok: boolean
  detail: string
}

export type AnnotatorVerdict = {
  ok: boolean
  touched: number
  angle: number
  breaksBelow: boolean
  checks: AnnotatorCheck[]
}

/**
 * kline-annotator：学员画完两个锚点后的即时反馈——判据与服务端证明器同口径
 * （触及数下限 / 斜率角区间 / 锚点区间不跌破），但**只在本机**给提示，不落库。
 */
export function annotatorVerdict(
  spec: WidgetSpec,
  points: readonly { idx: number; price: number }[],
): AnnotatorVerdict | null {
  if (spec.type !== 'kline-annotator' || points.length < 2) return null
  const first = points[0]!
  const second = points[1]!
  if (first.idx === second.idx) return null
  const bars = generateBars(spec.data.generator, spec.data.seed, spec.data.bars)
  const tol = 0.5 * atr(bars)
  const lineAt = (i: number) =>
    first.price + ((second.price - first.price) * (i - first.idx)) / (second.idx - first.idx)
  const from = Math.min(first.idx, second.idx)
  const to = Math.max(first.idx, second.idx)
  let touched = 0
  let breaksBelow = false
  for (let i = from; i <= to; i += 1) {
    const bar = bars[i]
    if (!bar) continue
    const price = lineAt(i)
    if (price >= bar.l - tol && price <= bar.h + tol) touched += 1
    if (bar.c < price - tol) breaksBelow = true
  }
  const scale = atr(bars)
  const delta = second.price - first.price
  const angle =
    scale === 0 ? 0 : (Math.atan(Math.abs(delta) / ((second.idx - first.idx) * scale)) * 180) / Math.PI
  const minTouch =
    (spec.assertions.trendlineTouches as { min?: number } | undefined)?.min ?? 2
  const slope = spec.assertions.slopeRange as { min?: number; max?: number } | undefined
  const checks: AnnotatorCheck[] = [
    {
      name: 'trendlineTouches',
      ok: touched >= minTouch,
      detail: `触及 ${touched} 根 K 线（下限 ${minTouch}）`,
    },
    {
      name: 'slopeRange',
      ok: slope ? angle >= (slope.min ?? 0) && angle <= (slope.max ?? 90) : true,
      detail: `斜率角 ${angle.toFixed(2)}°${slope ? `（要求 ${slope.min ?? 0}~${slope.max ?? 90}°）` : ''}`,
    },
    {
      name: 'noBreakBelow',
      ok: !breaksBelow,
      detail: breaksBelow ? '锚点区间内有收盘跌破趋势线' : '锚点区间内收盘未跌破趋势线',
    },
  ]
  return { ok: checks.every((check) => check.ok), touched, angle, breaksBelow, checks }
}

/** calc-trainer 示例复算（与服务端 examplesRecomputable 同公式同容差）。 */
export type CalcRow = {
  inputs: Record<string, number>
  answer: number
  recomputed: number | null
  ok: boolean
}

export function calcRows(spec: WidgetSpec): CalcRow[] {
  if (spec.type !== 'calc-trainer') return []
  const tolerance = spec.tolerance ?? 1e-6
  return spec.examples.map((example) => {
    const recomputed = calcFormula(spec.formula, example.inputs)
    const ok =
      recomputed !== null &&
      Math.abs(recomputed - example.answer) <= Math.max(tolerance * Math.abs(example.answer), 1e-9)
    return { inputs: example.inputs, answer: example.answer, recomputed, ok }
  })
}

export const CALC_FORMULA_LABELS: Record<string, string> = {
  'position-size': '仓位规模 = 可承受亏损额 ÷ 每股风险',
  'risk-reward': '盈亏比 = 止盈空间 ÷ 止损空间',
  'drawdown-recovery': '回撤后的回本涨幅 = 100 ÷ (100 − 回撤%) − 1',
}

// ---------------------------------------------------------------- 逐根回放

export type ReplayDecision = Extract<WidgetSpec, { type: 'bar-replay-decision' }>['decisions'][number]
export type ReplayAnnotation = Extract<WidgetSpec, { type: 'bar-replay-decision' }>['annotations'][number]

export type ReplayPlan = {
  bars: KlineBar[]
  /** 判断点（按日期升序）：barIdx = 窗口内 ≤ 该日的最后交易日下标。 */
  points: { index: number; decision: ReplayDecision; barIdx: number }[]
  /** 标注：同样按交易日归位。 */
  marks: { index: number; annotation: ReplayAnnotation; barIdx: number }[]
  /** 覆盖标记（案例事件）。 */
  overlays: { atDate: string; label: string; barIdx: number }[]
}

/** 交易日归位：窗口内 ≤ 该日的最后一根 bar；找不到 → -1（不伪造位置）。 */
export function barIndexAt(bars: readonly KlineBar[], date: string): number {
  let idx = -1
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i]!
    if (bar.d <= date) idx = i
    else break
  }
  return idx
}

export function replayPlan(spec: WidgetSpec, bars: readonly KlineBar[]): ReplayPlan | null {
  if (spec.type !== 'bar-replay-decision') return null
  const sorted = [...bars].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  const points = spec.decisions
    .map((decision, index) => ({ index, decision, barIdx: barIndexAt(sorted, decision.atDate) }))
    .sort((a, b) => a.barIdx - b.barIdx)
    .map((point, index) => ({ ...point, index }))
  const marks = spec.annotations
    .map((annotation, index) => ({ index, annotation, barIdx: barIndexAt(sorted, annotation.d) }))
    .sort((a, b) => a.barIdx - b.barIdx)
    .map((mark, index) => ({ ...mark, index }))
  const overlays = (spec.overlays ?? []).map((overlay) => ({
    atDate: overlay.atDate,
    label: overlay.label,
    barIdx: barIndexAt(sorted, overlay.atDate),
  }))
  return { bars: sorted, points, marks, overlays }
}

/** 揭示到 revealed 根时，下一个待作答的判断点（没有则 null）。 */
export function pendingDecision(
  plan: ReplayPlan,
  revealed: number,
  answeredCount: number,
): ReplayPlan['points'][number] | null {
  return (
    plan.points.find(
      (point) => point.index >= answeredCount && point.barIdx >= 0 && point.barIdx < revealed,
    ) ?? null
  )
}

/** 判断点对应的揭晓标注：日期晚于判断点的第一条（没有则 null）。 */
export function revealAnnotationFor(
  plan: ReplayPlan,
  decision: ReplayDecision,
): ReplayPlan['marks'][number] | null {
  return plan.marks.find((mark) => mark.annotation.d > decision.atDate) ?? null
}

/** 回放判题：correct 是选项文案（spec 里选项只有 label）。 */
export function replayVerdict(
  decision: ReplayDecision,
  selectedLabel: string | null,
): { correct: boolean; correctLabel: string } {
  return { correct: selectedLabel === decision.correct, correctLabel: decision.correct }
}

// ---------------------------------------------------------------- 分支情景

export type BranchingNode = Extract<WidgetSpec, { type: 'branching-scenario' }>['nodes'][number]

export function branchingNodes(spec: WidgetSpec): BranchingNode[] {
  if (spec.type !== 'branching-scenario') return []
  return spec.nodes
}

/** 走的路径是否与声明的最优路径一致（逐节点比对）。 */
export function pathMatchesOptimal(spec: WidgetSpec, path: readonly string[]): boolean {
  if (spec.type !== 'branching-scenario') return false
  if (path.length !== spec.optimalPath.length) return false
  return path.every((nodeId, i) => nodeId === spec.optimalPath[i])
}
