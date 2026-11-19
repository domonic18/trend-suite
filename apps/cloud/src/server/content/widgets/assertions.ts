import 'server-only'
import {
  ASSERTION_TYPES,
  atr,
  calcFormula,
  calcParamsInBounds,
  classifyShape,
  generateBars,
  type AssertionName,
  type Generator,
  type KlineBar,
  type WidgetBar,
  type WidgetIssue,
  type WidgetSpec,
} from '@trend-suite/contracts'

/**
 * 断言证明器（arch/06 §8）：逐条**程序证明**教学断言，产 WidgetIssue[]。
 * 纯函数 + 依赖注入（概念词表 / 素材单元 / 本节图示集 / 案例股真实行情）——
 * 无 LLM、无 DB、可单测。任一断言不成立 → 该课件不入库（引擎回灌重写）。
 *
 * 数值口径（arch/06 §8 未定义，此处定死；口径变了要同步渲染器）：
 * - ATR = 最近 min(14, n) 根 TR 的简单均值（TR = max(h−l, |h−prevC|, |l−prevC|)）；
 * - 触及/跌破容差 = 0.5 × ATR，按收盘价与影线范围判；
 * - 斜率角 = atan(|Δprice| / (Δidx × ATR)) 的度数（相对水平轴）；
 * - 相对容差 = max(1e-6 × |answer|, 1e-9)；
 * - 术语接地按**包含**判定（中文无词边界），概念名与别名同权。
 */

export type AssertionUnit = { assetId: string; startMs: number; endMs: number }

export type WidgetAssertionDeps = {
  /** 概念词表（name + aliases 原样）。 */
  terms: readonly string[]
  /** 本课程素材单元（id → 时间窗）。 */
  units: ReadonlyMap<string, AssertionUnit>
  /** 本节已落库图示集。 */
  figureIds: ReadonlySet<string>
  /** 案例股真实行情：code → bars（真实交易日由此得出；源不可用时为空）。 */
  barsByCode: ReadonlyMap<string, readonly KlineBar[]>
}

export type AssertionProof = {
  name: AssertionName
  status: 'pass' | 'fail'
  detail: string
}

export type AssertionProofResult = {
  proofs: AssertionProof[]
  issues: WidgetIssue[]
}

type Verdict = { ok: boolean; detail: string }

const pass = (detail: string): Verdict => ({ ok: true, detail })
const fail = (detail: string): Verdict => ({ ok: false, detail })

/** 相对容差：max(1e-6 × |answer|, 1e-9)。 */
export function relativeTolerance(answer: number): number {
  return Math.max(1e-6 * Math.abs(answer), 1e-9)
}

function barsOf(data: { generator: Generator; seed: number; bars: number }): WidgetBar[] {
  return generateBars(data.generator, data.seed, data.bars)
}

function containsTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => term.trim() !== '' && text.includes(term.trim()))
}

function isTerm(value: string, terms: readonly string[]): boolean {
  const norm = value.trim().toLowerCase()
  return terms.some((term) => term.trim().toLowerCase() === norm)
}

/** 数值区间参数：{min,max} 或 {min} / {max}。 */
function numParam(params: unknown, key: 'min' | 'max'): number | undefined {
  if (typeof params !== 'object' || params === null) return undefined
  const value = (params as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// ---------------------------------------------------------------- 各断言的判定

function checkTrendlineTouches(spec: WidgetSpec, params: unknown): Verdict {
  if (spec.type !== 'kline-annotator') return fail('断言不适用该组件类型')
  const min = numParam(params, 'min') ?? 2
  const bars = barsOf(spec.data)
  const { startIdx, endIdx } = spec.solution.trendline
  if (startIdx === endIdx) return fail('趋势线两个锚点索引相同，无法确定直线')
  if (startIdx < 0 || endIdx >= bars.length || startIdx > endIdx) {
    return fail(`趋势线锚点索引越界（bars 共 ${bars.length} 根，锚点 ${startIdx}→${endIdx}）`)
  }
  const c0 = bars[startIdx]!.c
  const c1 = bars[endIdx]!.c
  const tol = 0.5 * atr(bars)
  const lineAt = (i: number): number => c0 + ((c1 - c0) * (i - startIdx)) / (endIdx - startIdx)
  let touched = 0
  for (let i = startIdx; i <= endIdx; i += 1) {
    const bar = bars[i]!
    const price = lineAt(i)
    if (price >= bar.l - tol && price <= bar.h + tol) touched += 1
  }
  return touched >= min
    ? pass(`趋势线触及 ${touched} 根 K 线（下限 ${min}），容差 ${tol.toFixed(4)}`)
    : fail(`趋势线只触及 ${touched} 根 K 线（下限 ${min}）；容差 ${tol.toFixed(4)}，请调整两个锚点索引`)
}

function checkSlopeRange(spec: WidgetSpec, params: unknown): Verdict {
  if (spec.type !== 'kline-annotator') return fail('断言不适用该组件类型')
  const min = numParam(params, 'min')
  const max = numParam(params, 'max')
  if (min === undefined || max === undefined) return fail('slopeRange 缺 min/max 角度参数')
  const bars = barsOf(spec.data)
  const { startIdx, endIdx } = spec.solution.trendline
  if (endIdx === startIdx) return fail('趋势线两个锚点索引相同，斜率无定义')
  if (startIdx < 0 || endIdx >= bars.length) {
    return fail(`趋势线锚点索引越界（bars 共 ${bars.length} 根）`)
  }
  const scale = atr(bars)
  const delta = bars[endIdx]!.c - bars[startIdx]!.c
  const angle =
    scale === 0 ? 0 : (Math.atan(Math.abs(delta) / ((endIdx - startIdx) * scale)) * 180) / Math.PI
  return angle >= min && angle <= max
    ? pass(`趋势线斜率角 ${angle.toFixed(2)}° 落在 [${min}, ${max}] 内`)
    : fail(`趋势线斜率角 ${angle.toFixed(2)}° 不在 [${min}, ${max}] 内，请调整锚点或区间`)
}

function checkNoBreakBelow(spec: WidgetSpec): Verdict {
  if (spec.type !== 'kline-annotator') return fail('断言不适用该组件类型')
  const bars = barsOf(spec.data)
  const { startIdx, endIdx } = spec.solution.trendline
  if (endIdx === startIdx) return fail('趋势线两个锚点索引相同，无法判定跌破')
  if (startIdx < 0 || endIdx >= bars.length) return fail('趋势线锚点索引越界')
  const c0 = bars[startIdx]!.c
  const c1 = bars[endIdx]!.c
  const tol = 0.5 * atr(bars)
  const lineAt = (i: number): number => c0 + ((c1 - c0) * (i - startIdx)) / (endIdx - startIdx)
  for (let i = startIdx; i <= endIdx; i += 1) {
    const bar = bars[i]!
    if (bar.c < lineAt(i) - tol) {
      return fail(`第 ${i} 根收盘 ${bar.c} 跌破趋势线 ${lineAt(i).toFixed(2)}（容差 ${tol.toFixed(4)}）`)
    }
  }
  return pass(`锚点区间 ${startIdx}→${endIdx} 内收盘价均未跌破趋势线`)
}

/** pattern-quiz / mcq-quiz：answerId ∈ options 且 id 唯一。 */
function checkAnswerUniqueById(spec: WidgetSpec): Verdict {
  if (spec.type !== 'pattern-quiz' && spec.type !== 'mcq-quiz') return fail('断言不适用该组件类型')
  const ids = spec.options.map((option) => option.id)
  if (new Set(ids).size !== ids.length) return fail('选项 id 有重复，答案不唯一')
  if (!ids.includes(spec.answerId)) return fail(`answerId=${spec.answerId} 不在选项 id 列表内`)
  return pass(`answerId=${spec.answerId} 唯一命中 ${ids.length} 个选项`)
}

/** bar-replay-decision：correct 恰命中一个选项文案，且选项文案互异。 */
function checkAnswerUniqueByLabel(spec: WidgetSpec): Verdict {
  if (spec.type !== 'bar-replay-decision') return fail('断言不适用该组件类型')
  const labels = spec.decisions.flatMap((decision) => decision.options.map((option) => option.label))
  const decisionLabels = spec.decisions.map((decision) => decision.correct)
  const hits = decisionLabels.map((correct) => labels.filter((label) => label === correct).length)
  const bad = hits.findIndex((count) => count !== 1)
  if (bad >= 0) {
    return fail(
      `第 ${bad + 1} 个判断点的 correct「${decisionLabels[bad]}」命中 ${hits[bad]} 个选项文案，须恰为 1 个`,
    )
  }
  return pass(`${decisionLabels.length} 个判断点的正确项均唯一命中选项文案`)
}

function checkDistractorsDistinct(spec: WidgetSpec): Verdict {
  if (spec.type !== 'pattern-quiz') return fail('断言不适用该组件类型')
  const shapes = spec.options.map((option) => {
    const generator = option.generator ?? spec.data.generator
    const seed = option.seed ?? spec.data.seed
    const count = option.bars ?? spec.data.bars
    return classifyShape(barsOf({ generator, seed, bars: count }))
  })
  const answerIndex = spec.options.findIndex((option) => option.id === spec.answerId)
  if (answerIndex < 0) return fail(`answerId=${spec.answerId} 不在选项列表内`)
  const distinct = new Set(shapes)
  if (distinct.size !== shapes.length) {
    return fail(`各选项形态归类有重复（${shapes.join('、')}），干扰项须互不相同`)
  }
  const answerShape = shapes[answerIndex]
  if (answerShape !== classifyShape(barsOf(spec.data))) {
    return fail(`正确项形态归类 ${answerShape} 与题目声明的 ${classifyShape(barsOf(spec.data))} 不一致`)
  }
  return pass(`${shapes.length} 个选项形态归类互不相同（${shapes.join('、')}）`)
}

function checkPatternMatchesAnswer(spec: WidgetSpec, params: unknown): Verdict {
  if (spec.type !== 'pattern-quiz') return fail('断言不适用该组件类型')
  const declared = params
  if (typeof declared !== 'string') return fail('patternMatchesAnswer 缺生成器 id 参数')
  const answer = spec.options.find((option) => option.id === spec.answerId)
  if (!answer) return fail(`answerId=${spec.answerId} 不在选项列表内`)
  const generator = answer.generator ?? spec.data.generator
  const seed = answer.seed ?? spec.data.seed
  const count = answer.bars ?? spec.data.bars
  const shape = classifyShape(barsOf({ generator, seed, bars: count }))
  if (shape !== declared) {
    return fail(`正确项实际形态归类 ${shape}，与声明的 ${declared} 不符（seed=${seed}、${count} 根）`)
  }
  return pass(`正确项形态归类 ${shape} 与声明一致`)
}

function checkMarkersInRange(spec: WidgetSpec): Verdict {
  if (spec.type !== 'step-reveal') return fail('断言不适用该组件类型')
  const bars = barsOf(spec.data)
  const tol = atr(bars)
  let previousTo = -1
  for (const [index, step] of spec.steps.entries()) {
    if (step.fromIdx > step.toIdx) return fail(`第 ${index + 1} 步窗口倒置（${step.fromIdx}→${step.toIdx}）`)
    if (step.toIdx >= bars.length || step.fromIdx < 0) {
      return fail(`第 ${index + 1} 步窗口越界（bars 共 ${bars.length} 根，窗口 ${step.fromIdx}→${step.toIdx}）`)
    }
    if (step.fromIdx <= previousTo) {
      return fail(`第 ${index + 1} 步窗口与前一步重叠或不单调（前一止于 ${previousTo}，本步起于 ${step.fromIdx}）`)
    }
    previousTo = step.toIdx
    for (const marker of step.markers ?? []) {
      if (marker.idx < step.fromIdx || marker.idx > step.toIdx) {
        return fail(`第 ${index + 1} 步标记 idx=${marker.idx} 不在本步窗口 ${step.fromIdx}→${step.toIdx} 内`)
      }
      const bar = bars[marker.idx]!
      if (marker.price < bar.l - tol || marker.price > bar.h + tol) {
        return fail(
          `第 ${index + 1} 步标记价 ${marker.price} 不在第 ${marker.idx} 根的高低区间 ${bar.l}~${bar.h}（容差 ${tol.toFixed(4)}）`,
        )
      }
    }
  }
  return pass(`${spec.steps.length} 步窗口单调不重叠且标记落位`)
}

function checkConclusionsNonEmpty(spec: WidgetSpec): Verdict {
  if (spec.type !== 'step-reveal') return fail('断言不适用该组件类型')
  const emptyStep = spec.steps.findIndex((step) => step.conclusion.trim() === '')
  if (emptyStep >= 0) return fail(`第 ${emptyStep + 1} 步结论为空`)
  if (spec.finalConclusion.trim() === '') return fail('最终结论为空')
  return pass(`${spec.steps.length} 步结论与最终结论均非空`)
}

function checkExamplesRecomputable(spec: WidgetSpec): Verdict {
  if (spec.type !== 'calc-trainer') return fail('断言不适用该组件类型')
  const declaredTolerance = spec.tolerance
  for (const [index, example] of spec.examples.entries()) {
    const computed = calcFormula(spec.formula, example.inputs)
    if (computed === null) {
      return fail(`第 ${index + 1} 个示例的参数不满足公式 ${spec.formula} 的域，无法复算`)
    }
    const tolerance = declaredTolerance ?? relativeTolerance(example.answer)
    if (Math.abs(computed - example.answer) > tolerance) {
      return fail(
        `第 ${index + 1} 个示例复算得 ${computed}，声明答案 ${example.answer}（容差 ${tolerance}）`,
      )
    }
  }
  return pass(`${spec.examples.length} 个示例按 ${spec.formula} 复算一致`)
}

function checkParamsInBounds(spec: WidgetSpec): Verdict {
  if (spec.type !== 'calc-trainer') return fail('断言不适用该组件类型')
  if (!calcParamsInBounds(spec.formula, spec.inputs)) {
    return fail(`顶层 inputs 越出 ${spec.formula} 的参数域`)
  }
  for (const [index, example] of spec.examples.entries()) {
    if (!calcParamsInBounds(spec.formula, example.inputs)) {
      return fail(`第 ${index + 1} 个示例的 inputs 越出 ${spec.formula} 的参数域`)
    }
  }
  return pass(`inputs 与全部示例参数落在 ${spec.formula} 的参数域内`)
}

function checkTermsInConcepts(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  const refs: { where: string; value: string }[] = []
  if (spec.type === 'mcq-quiz') {
    for (const ref of spec.conceptRefs) refs.push({ where: 'conceptRefs', value: ref })
  } else if (spec.type === 'flashcards') {
    for (const [index, card] of spec.cards.entries()) {
      refs.push({ where: `第 ${index + 1} 张卡片的 conceptRef`, value: card.conceptRef })
    }
  } else if (spec.type === 'checklist') {
    for (const [index, item] of spec.items.entries()) {
      if (item.conceptRef) refs.push({ where: `第 ${index + 1} 条的 conceptRef`, value: item.conceptRef })
    }
  } else {
    return fail('断言不适用该组件类型')
  }
  const bad = refs.find((ref) => !isTerm(ref.value, deps.terms))
  if (bad) return fail(`${bad.where}「${bad.value}」不在本课程概念表（name 与别名）内`)
  return pass(`${refs.length} 处术语引用全部落在概念表内`)
}

function checkCardCount(spec: WidgetSpec, params: unknown): Verdict {
  if (spec.type !== 'flashcards') return fail('断言不适用该组件类型')
  const min = numParam(params, 'min') ?? 3
  const max = numParam(params, 'max') ?? 20
  const count = spec.cards.length
  return count >= min && count <= max
    ? pass(`卡片数 ${count} 落在 [${min}, ${max}] 内`)
    : fail(`卡片数 ${count} 不在 [${min}, ${max}] 内`)
}

function checkItemsNonEmpty(spec: WidgetSpec): Verdict {
  if (spec.type !== 'checklist') return fail('断言不适用该组件类型')
  if (spec.items.length < 3) return fail(`清单条目 ${spec.items.length} 条，少于 3 条`)
  const bad = spec.items.findIndex((item) => item.text.trim() === '' || item.text.length > 200)
  if (bad >= 0) return fail(`第 ${bad + 1} 条为空或超过 200 字`)
  return pass(`${spec.items.length} 条清单条目均非空`)
}

function checkEdgeRefsExist(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  if (spec.type !== 'timeline-explorer') return fail('断言不适用该组件类型')
  const nodeRefs = spec.nodes.map((node) => node.conceptRef)
  const unknown = nodeRefs.find((ref) => !isTerm(ref, deps.terms))
  if (unknown) return fail(`节点概念「${unknown}」不在本课程概念表内`)
  const nodeSet = new Set(nodeRefs)
  for (const edge of spec.edges) {
    if (!isTerm(edge.from, deps.terms) || !isTerm(edge.to, deps.terms)) {
      return fail(`边 ${edge.from}→${edge.to} 的端点不在本课程概念表内`)
    }
    if (!nodeSet.has(edge.from) || !nodeSet.has(edge.to)) {
      return fail(`边 ${edge.from}→${edge.to} 的端点不在本组件的节点列表内`)
    }
  }
  return pass(`${nodeRefs.length} 个节点、${spec.edges.length} 条边的概念引用均存在`)
}

function checkAcyclicPrerequisite(spec: WidgetSpec): Verdict {
  if (spec.type !== 'timeline-explorer') return fail('断言不适用该组件类型')
  const edges = spec.edges.filter((edge) => edge.kind === 'prerequisite')
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge.to)
    adjacency.set(edge.from, list)
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const walk = (node: string): string | null => {
    const current = state.get(node)
    if (current === 'done') return null
    if (current === 'visiting') return node
    state.set(node, 'visiting')
    for (const next of adjacency.get(node) ?? []) {
      const cycle = walk(next)
      if (cycle) return cycle
    }
    state.set(node, 'done')
    return null
  }
  for (const node of adjacency.keys()) {
    const cycle = walk(node)
    if (cycle) return fail(`prerequisite 子图有环：${cycle}→…`)
  }
  return pass(`prerequisite 子图（${edges.length} 条边）无环`)
}

function checkPairSidesValid(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  if (spec.type !== 'image-juxtaposition') return fail('断言不适用该组件类型')
  for (const side of ['left', 'right'] as const) {
    const value = spec[side]
    if ('figureId' in value) {
      if (!deps.figureIds.has(value.figureId)) {
        return fail(`${side} 侧的 figureId=${value.figureId} 不在本节图示集内`)
      }
    } else {
      if (value.bars < 20 || value.bars > 120) return fail(`${side} 侧的 bars=${value.bars} 越出 20–120`)
      if (value.seed < 0 || value.seed >= 2 ** 31) return fail(`${side} 侧的 seed=${value.seed} 越界`)
    }
  }
  return pass('两侧素材合法（figureId 在本节图示集内 / 生成器参数在域内）')
}

function checkCaptionsGrounded(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  if (spec.type !== 'image-juxtaposition') return fail('断言不适用该组件类型')
  if (!containsTerm(spec.captions.left, deps.terms)) {
    return fail(`左侧 caption 未包含任何概念词（可用术语：${deps.terms.slice(0, 8).join('、')}…）`)
  }
  if (!containsTerm(spec.captions.right, deps.terms)) {
    return fail(`右侧 caption 未包含任何概念词（可用术语：${deps.terms.slice(0, 8).join('、')}…）`)
  }
  return pass('两条 caption 均含概念词')
}

/** 分支图：节点 → 选项 → next（null = 终点）。 */
function branchGraph(spec: WidgetSpec): {
  nodes: Map<string, { options: { label: string; next: string | null; feedback: string }[] }>
  order: string[]
} {
  const nodes = new Map<string, { options: { label: string; next: string | null; feedback: string }[] }>()
  const order: string[] = []
  for (const node of spec.type === 'branching-scenario' ? spec.nodes : []) {
    nodes.set(node.id, { options: node.options })
    order.push(node.id)
  }
  return { nodes, order }
}

function checkGraphAcyclic(spec: WidgetSpec): Verdict {
  if (spec.type !== 'branching-scenario') return fail('断言不适用该组件类型')
  const { nodes } = branchGraph(spec)
  const state = new Map<string, 'visiting' | 'done'>()
  const walk = (node: string): string | null => {
    const current = state.get(node)
    if (current === 'done') return null
    if (current === 'visiting') return node
    state.set(node, 'visiting')
    for (const option of nodes.get(node)?.options ?? []) {
      if (option.next === null) continue
      if (!nodes.has(option.next)) return `${option.next}（不存在的节点）`
      const cycle = walk(option.next)
      if (cycle) return cycle
    }
    state.set(node, 'done')
    return null
  }
  for (const node of nodes.keys()) {
    const cycle = walk(node)
    if (cycle) return fail(`决策图有环：${cycle}→…`)
  }
  return pass(`${nodes.size} 个节点构成的决策图无环`)
}

/** 终点可达性：每个可达节点都能走到某个「可结束」节点（含 next=null 选项）。 */
function checkAllPathsTerminate(spec: WidgetSpec): Verdict {
  if (spec.type !== 'branching-scenario') return fail('断言不适用该组件类型')
  const { nodes } = branchGraph(spec)
  if (!nodes.has(spec.entryId)) return fail(`entryId=${spec.entryId} 不在节点列表内`)
  const terminable = new Map<string, boolean>()
  const canTerminate = (node: string, seen: Set<string>): boolean => {
    const cached = terminable.get(node)
    if (cached !== undefined) return cached
    if (seen.has(node)) return false
    seen.add(node)
    const options = nodes.get(node)?.options ?? []
    if (options.some((option) => option.next === null)) {
      terminable.set(node, true)
      return true
    }
    const ok = options.some((option) => option.next !== null && canTerminate(option.next, seen))
    terminable.set(node, ok)
    return ok
  }
  const reachable = new Set<string>()
  const collect = (node: string): void => {
    if (reachable.has(node)) return
    reachable.add(node)
    for (const option of nodes.get(node)?.options ?? []) {
      if (option.next !== null && nodes.has(option.next)) collect(option.next)
    }
  }
  collect(spec.entryId)
  for (const node of reachable) {
    if (!canTerminate(node, new Set())) {
      return fail(`节点 ${node} 出发无法走到可结束节点（全部路径都会停在半路）`)
    }
  }
  return pass(`${reachable.size} 个可达节点均可走到终点`)
}

function checkOptimalPathReachable(spec: WidgetSpec): Verdict {
  if (spec.type !== 'branching-scenario') return fail('断言不适用该组件类型')
  const { nodes } = branchGraph(spec)
  const path = spec.optimalPath
  if (path[0] !== spec.entryId) {
    return fail(`最优路径起点 ${path[0]} 与 entryId=${spec.entryId} 不一致`)
  }
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i]!
    const to = path[i + 1]!
    const options = nodes.get(from)?.options ?? []
    if (!options.some((option) => option.next === to)) {
      return fail(`最优路径在 ${from}→${to} 处断开：${from} 没有指向 ${to} 的选项`)
    }
  }
  const last = path[path.length - 1]!
  const lastOptions = nodes.get(last)?.options ?? []
  if (!lastOptions.some((option) => option.next === null)) {
    return fail(`最优路径终点 ${last} 没有可结束（next 为空）的选项`)
  }
  return pass(`最优路径自 ${spec.entryId} 连通至 ${last}（${path.length} 个节点）`)
}

function checkFeedbackNonEmpty(spec: WidgetSpec): Verdict {
  if (spec.type !== 'branching-scenario') return fail('断言不适用该组件类型')
  for (const node of spec.nodes) {
    for (const [index, option] of node.options.entries()) {
      if (option.feedback.trim() === '') {
        return fail(`节点 ${node.id} 的第 ${index + 1} 个选项反馈为空`)
      }
    }
  }
  return pass('全部选项的反馈均非空')
}

/** 判断点/标注的接地：单元存在、atMs 落窗、日期落案例窗且是真实交易日。 */
function checkDecisionPointsGrounded(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  if (spec.type !== 'bar-replay-decision') return fail('断言不适用该组件类型')
  const bars = deps.barsByCode.get(spec.code) ?? []
  if (bars.length === 0) {
    return fail(`案例股 ${spec.code} 没有真实行情（源不可用），无法证明判断点接地`)
  }
  const tradingDays = new Set(bars.map((bar) => bar.d))
  const inWindow = (date: string): boolean => date >= spec.window.from && date <= spec.window.to

  for (const [index, annotation] of spec.annotations.entries()) {
    const unit = deps.units.get(annotation.unitId)
    if (!unit) return fail(`第 ${index + 1} 个标注的 unitId=${annotation.unitId} 不存在`)
    if (annotation.atMs < unit.startMs || annotation.atMs > unit.endMs) {
      return fail(
        `第 ${index + 1} 个标注的 atMs=${annotation.atMs} 不在素材单元窗 ${unit.startMs}~${unit.endMs} 内`,
      )
    }
    if (!inWindow(annotation.d)) {
      return fail(`第 ${index + 1} 个标注的日期 ${annotation.d} 不在案例窗 ${spec.window.from}~${spec.window.to} 内`)
    }
    if (!tradingDays.has(annotation.d)) {
      return fail(`第 ${index + 1} 个标注的日期 ${annotation.d} 不是案例股 ${spec.code} 的交易日`)
    }
  }
  for (const [index, decision] of spec.decisions.entries()) {
    const unit = deps.units.get(decision.unitId)
    if (!unit) return fail(`第 ${index + 1} 个判断点的 unitId=${decision.unitId} 不存在`)
    if (decision.atMs < unit.startMs || decision.atMs > unit.endMs) {
      return fail(
        `第 ${index + 1} 个判断点的 atMs=${decision.atMs} 不在素材单元窗 ${unit.startMs}~${unit.endMs} 内`,
      )
    }
    if (!inWindow(decision.atDate)) {
      return fail(
        `第 ${index + 1} 个判断点的日期 ${decision.atDate} 不在案例窗 ${spec.window.from}~${spec.window.to} 内`,
      )
    }
    if (!tradingDays.has(decision.atDate)) {
      return fail(`第 ${index + 1} 个判断点的日期 ${decision.atDate} 不是案例股 ${spec.code} 的交易日`)
    }
  }
  return pass(
    `${spec.annotations.length} 个标注与 ${spec.decisions.length} 个判断点均接地（单元在、时窗在、日期是交易日）`,
  )
}

/** 遮罩单调：判断点日期严格递增；每个判断点之后有可揭晓的标注。 */
function checkRevealMonotonic(spec: WidgetSpec): Verdict {
  if (spec.type !== 'bar-replay-decision') return fail('断言不适用该组件类型')
  for (let i = 1; i < spec.decisions.length; i += 1) {
    const previous = spec.decisions[i - 1]!.atDate
    const current = spec.decisions[i]!.atDate
    if (current <= previous) {
      return fail(`判断点日期非严格递增（第 ${i} 个 ${previous} → 第 ${i + 1} 个 ${current}）`)
    }
  }
  const annotationDates = [...spec.annotations].map((annotation) => annotation.d).sort()
  for (const [index, decision] of spec.decisions.entries()) {
    const paired = annotationDates.find((date) => date >= decision.atDate)
    if (!paired) {
      return fail(`第 ${index + 1} 个判断点（${decision.atDate}）之后没有可揭晓的标注日期`)
    }
    if (paired < decision.atDate) {
      return fail(`第 ${index + 1} 个判断点的揭晓早于判断本身`)
    }
  }
  return pass(`${spec.decisions.length} 个判断点日期严格递增，遮罩区间单调不重叠`)
}

/** 术语有据：揭晓文案含概念词且非空；标注文案非空。 */
function checkAnnotationTermsGrounded(spec: WidgetSpec, deps: WidgetAssertionDeps): Verdict {
  if (spec.type !== 'bar-replay-decision') return fail('断言不适用该组件类型')
  for (const [index, annotation] of spec.annotations.entries()) {
    if (annotation.label.trim() === '') return fail(`第 ${index + 1} 个标注的说明为空`)
  }
  for (const [index, decision] of spec.decisions.entries()) {
    if (decision.revealText.trim() === '') return fail(`第 ${index + 1} 个判断点的揭晓文案为空`)
    if (deps.terms.length > 0 && !containsTerm(decision.revealText, deps.terms)) {
      return fail(
        `第 ${index + 1} 个判断点的揭晓文案未包含任何概念词（可用术语：${deps.terms.slice(0, 8).join('、')}…）`,
      )
    }
  }
  return pass('标注与揭晓文案的术语均有据')
}

// ---------------------------------------------------------------- 调度

type Checker = (spec: WidgetSpec, params: unknown, deps: WidgetAssertionDeps) => Verdict

const CHECKERS: Record<AssertionName, Checker> = {
  trendlineTouches: (spec, params) => checkTrendlineTouches(spec, params),
  slopeRange: (spec, params) => checkSlopeRange(spec, params),
  noBreakBelow: (spec) => checkNoBreakBelow(spec),
  answerUnique: (spec) =>
    spec.type === 'bar-replay-decision' ? checkAnswerUniqueByLabel(spec) : checkAnswerUniqueById(spec),
  distractorsDistinct: (spec) => checkDistractorsDistinct(spec),
  patternMatchesAnswer: (spec, params) => checkPatternMatchesAnswer(spec, params),
  markersInRange: (spec) => checkMarkersInRange(spec),
  conclusionsNonEmpty: (spec) => checkConclusionsNonEmpty(spec),
  examplesRecomputable: (spec) => checkExamplesRecomputable(spec),
  paramsInBounds: (spec) => checkParamsInBounds(spec),
  termsInConcepts: (spec, _params, deps) => checkTermsInConcepts(spec, deps),
  cardCount: (spec, params) => checkCardCount(spec, params),
  itemsNonEmpty: (spec) => checkItemsNonEmpty(spec),
  edgeRefsExist: (spec, _params, deps) => checkEdgeRefsExist(spec, deps),
  acyclicPrerequisite: (spec) => checkAcyclicPrerequisite(spec),
  pairSidesValid: (spec, _params, deps) => checkPairSidesValid(spec, deps),
  captionsGrounded: (spec, _params, deps) => checkCaptionsGrounded(spec, deps),
  graphAcyclic: (spec) => checkGraphAcyclic(spec),
  allPathsTerminate: (spec) => checkAllPathsTerminate(spec),
  optimalPathReachable: (spec) => checkOptimalPathReachable(spec),
  feedbackNonEmpty: (spec) => checkFeedbackNonEmpty(spec),
  decisionPointsGrounded: (spec, _params, deps) => checkDecisionPointsGrounded(spec, deps),
  revealMonotonic: (spec) => checkRevealMonotonic(spec),
  annotationTermsGrounded: (spec, _params, deps) => checkAnnotationTermsGrounded(spec, deps),
}

/** 断言是否适用于该组件类型（arch/06 §8 的适用组件列）。 */
export function assertionAppliesTo(name: AssertionName, type: string): boolean {
  return (ASSERTION_TYPES[name] as readonly string[]).includes(type)
}

/** 逐条证明 spec 里声明的全部断言；返回证明记录与问题清单。 */
export function proveAssertions(spec: WidgetSpec, deps: WidgetAssertionDeps): AssertionProofResult {
  const proofs: AssertionProof[] = []
  const issues: WidgetIssue[] = []
  const entries = Object.entries(spec.assertions) as [AssertionName, unknown][]
  for (const [name, params] of entries) {
    const checker = CHECKERS[name]
    if (!checker) {
      issues.push({ code: 'widget_spec_invalid', message: `未知断言名 ${name}`, assertion: name })
      continue
    }
    if (!assertionAppliesTo(name, spec.type)) {
      issues.push({
        code: 'assertion_not_applicable',
        message: `断言 ${name} 不适用于 ${spec.type}`,
        assertion: name,
      })
      continue
    }
    const verdict = checker(spec, params, deps)
    proofs.push({ name, status: verdict.ok ? 'pass' : 'fail', detail: verdict.detail })
    if (!verdict.ok) {
      issues.push({
        code: 'assertion_unproven',
        message: `${name} 不成立：${verdict.detail}`,
        assertion: name,
        detail: verdict.detail,
      })
    }
  }
  return { proofs, issues }
}
