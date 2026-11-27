import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateBars, type KlineBar, type WidgetSpec } from '@trend-suite/contracts'
import {
  annotatorVerdict,
  barIndexAt,
  branchingNodes,
  calcRows,
  mcqVerdict,
  pathMatchesOptimal,
  patternOptionViews,
  patternVerdict,
  pendingDecision,
  replayPlan,
  replayVerdict,
  revealAnnotationFor,
} from './widgetView'

/**
 * 课件视图模型与判题逻辑（arch/06 §10）：纯函数单测。
 * React DOM 测试在本仓不可行（react-server 条件下无 useEffect），
 * 故「怎么判、怎么算、怎么排」必须在这里钉住。
 */

const CITATIONS = ['su_abc123']

function mcqSpec(answerId = 'b'): WidgetSpec {
  return {
    type: 'mcq-quiz',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { answerUnique: true, termsInConcepts: true },
    question: '什么是趋势？',
    options: [
      { id: 'a', label: '价格的方向性运动' },
      { id: 'b', label: '价格的无方向横盘' },
    ],
    answerId,
    conceptRefs: ['趋势'],
  }
}

test('mcqVerdict：选对选错都给出答案文案', () => {
  const spec = mcqSpec()
  const right = mcqVerdict(spec, 'b')
  assert.equal(right?.correct, true)
  assert.equal(right?.answerText, '价格的无方向横盘')
  const wrong = mcqVerdict(spec, 'a')
  assert.equal(wrong?.correct, false)
  assert.equal(mcqVerdict(spec, null), null)
})

test('patternOptionViews：选项 K 线由生成器复算，形态只看 bars', () => {
  const spec: WidgetSpec = {
    type: 'pattern-quiz',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { answerUnique: true, distractorsDistinct: true },
    data: { generator: 'uptrend', seed: 11, bars: 40 },
    question: '哪条是上升趋势？',
    options: [
      { id: 'up', label: '上升', generator: 'uptrend', seed: 11, bars: 40 },
      { id: 'down', label: '下降', generator: 'downtrend', seed: 22, bars: 40 },
      { id: 'flat', label: '横盘', generator: 'range', seed: 33, bars: 40 },
    ],
    answerId: 'up',
  }
  const views = patternOptionViews(spec)
  assert.equal(views.length, 3)
  assert.equal(views[0]?.shape, 'uptrend')
  assert.equal(views[1]?.shape, 'downtrend')
  assert.equal(views[2]?.shape, 'range')
  // 同参数必得同一串数值（可重放）
  assert.deepEqual(views[0]?.bars, generateBars('uptrend', 11, 40))
  assert.equal(patternVerdict(spec, 'up')?.correct, true)
  assert.equal(patternVerdict(spec, 'flat')?.correct, false)
})

test('annotatorVerdict：线画在天上 → 不触及且跌破，三项检查都要说人话', () => {
  const spec: WidgetSpec = {
    type: 'kline-annotator',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { trendlineTouches: { min: 2 }, slopeRange: { min: 0, max: 90 }, noBreakBelow: true },
    data: { generator: 'uptrend', seed: 7, bars: 60 },
    task: '画出趋势线',
    solution: { trendline: { startIdx: 5, endIdx: 40 } },
  }
  const none = annotatorVerdict(spec, [])
  assert.equal(none, null)
  const same = annotatorVerdict(spec, [{ idx: 3, price: 100 }, { idx: 3, price: 101 }])
  assert.equal(same, null)

  const far = annotatorVerdict(spec, [
    { idx: 0, price: 1_000_000 },
    { idx: 20, price: 1_000_000 },
  ])
  assert.ok(far)
  assert.deepEqual(far.checks.map((check) => check.name), ['trendlineTouches', 'slopeRange', 'noBreakBelow'])
  assert.equal(far.touched, 0)
  assert.equal(far.breaksBelow, true)
  assert.equal(far.checks.find((check) => check.name === 'trendlineTouches')?.ok, false)
  assert.equal(far.checks.find((check) => check.name === 'noBreakBelow')?.ok, false)
  assert.equal(far.ok, false)
})

test('annotatorVerdict：贴着趋势走 → 触及够数且不跌破', () => {
  const spec: WidgetSpec = {
    type: 'kline-annotator',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { trendlineTouches: { min: 2 }, slopeRange: { min: 0, max: 90 }, noBreakBelow: true },
    data: { generator: 'uptrend', seed: 7, bars: 60 },
    task: '画出趋势线',
    solution: { trendline: { startIdx: 5, endIdx: 40 } },
  }
  const bars = generateBars('uptrend', 7, 60)
  const verdict = annotatorVerdict(spec, [
    { idx: 5, price: bars[5]!.c },
    { idx: 15, price: bars[15]!.c },
  ])
  assert.ok(verdict)
  assert.ok(verdict.touched >= 2)
  assert.equal(verdict.breaksBelow, false)
  assert.equal(verdict.ok, true)
})

test('calcRows：示例按公式复算，答案对不上即 ok=false', () => {
  const spec: WidgetSpec = {
    type: 'calc-trainer',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { examplesRecomputable: true, paramsInBounds: true },
    formula: 'risk-reward',
    inputs: { entryPrice: 10, stopPrice: 8, targetPrice: 14 },
    examples: [
      { inputs: { entryPrice: 10, stopPrice: 8, targetPrice: 14 }, answer: 2 },
      { inputs: { entryPrice: 20, stopPrice: 18, targetPrice: 26 }, answer: 1 },
    ],
    tolerance: 1e-6,
  }
  const rows = calcRows(spec)
  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.ok, true)
  assert.equal(rows[0]?.recomputed, 2)
  assert.equal(rows[1]?.ok, false)
})

test('calcRows：参数越界不猜——recomputed 为 null', () => {
  const spec: WidgetSpec = {
    type: 'calc-trainer',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { examplesRecomputable: true, paramsInBounds: true },
    formula: 'risk-reward',
    inputs: { entryPrice: 10, stopPrice: 12, targetPrice: 14 },
    examples: [{ inputs: { entryPrice: 10, stopPrice: 12, targetPrice: 14 }, answer: 1 }],
  }
  const rows = calcRows(spec)
  assert.equal(rows[0]?.recomputed, null)
  assert.equal(rows[0]?.ok, false)
})

// ---------------------------------------------------------------- 逐根回放

const REPLAY_BARS: KlineBar[] = [
  { d: '2024-03-01', o: 10, h: 11, l: 9.5, c: 10.5, v: 100 },
  { d: '2024-03-04', o: 10.5, h: 12, l: 10, c: 11.5, v: 120 },
  { d: '2024-03-05', o: 11.5, h: 12.5, l: 11, c: 11, v: 90 },
  { d: '2024-03-06', o: 11, h: 13, l: 10.8, c: 12.5, v: 150 },
  { d: '2024-03-07', o: 12.5, h: 13.5, l: 12, c: 13, v: 170 },
]

function replaySpec(): WidgetSpec {
  return {
    type: 'bar-replay-decision',
    specVersion: 1,
    citations: CITATIONS,
    assertions: {
      answerUnique: true,
      decisionPointsGrounded: true,
      revealMonotonic: true,
      annotationTermsGrounded: true,
    },
    code: '600519',
    window: { from: '2024-03-01', to: '2024-03-07' },
    overlays: [{ atDate: '2024-03-04', label: '起涨' }],
    annotations: [
      { unitId: 'su_abc123', atMs: 1000, kind: 'structure', d: '2024-03-05', label: '回踩不破' },
      { unitId: 'su_abc123', atMs: 2000, kind: 'invalidation', d: '2024-03-07', label: '跌破失效' },
    ],
    decisions: [
      {
        atDate: '2024-03-04',
        question: '这根之后该做什么？',
        options: [{ label: '持有' }, { label: '减仓' }],
        correct: '持有',
        revealText: '结构未破坏，继续持有。',
        unitId: 'su_abc123',
        atMs: 1000,
      },
      {
        atDate: '2024-03-06',
        question: '现在？',
        options: [{ label: '加仓' }, { label: '离场' }],
        correct: '离场',
        revealText: '跌破结构位，离场。',
        unitId: 'su_abc123',
        atMs: 2000,
      },
    ],
  }
}

test('barIndexAt：日期归位到窗口内最后一根，找不到不伪造', () => {
  assert.equal(barIndexAt(REPLAY_BARS, '2024-03-04'), 1)
  assert.equal(barIndexAt(REPLAY_BARS, '2024-03-05'), 2)
  assert.equal(barIndexAt(REPLAY_BARS, '2024-02-01'), -1)
})

test('replayPlan：判断点与标注按交易日归位、按位置排序', () => {
  const plan = replayPlan(replaySpec(), REPLAY_BARS)
  assert.ok(plan)
  assert.equal(plan.bars.length, 5)
  assert.deepEqual(plan.points.map((point) => point.barIdx), [1, 3])
  assert.deepEqual(plan.marks.map((mark) => mark.barIdx), [2, 4])
  assert.equal(plan.overlays[0]?.barIdx, 1)
})

test('pendingDecision：揭示到判断点才出题，已答过的不再问', () => {
  const plan = replayPlan(replaySpec(), REPLAY_BARS)
  assert.ok(plan)
  assert.equal(pendingDecision(plan, 2, 0)?.decision.atDate, '2024-03-04')
  // 第一个已答 → 轮到第二个
  assert.equal(pendingDecision(plan, 4, 1)?.decision.atDate, '2024-03-06')
  // 还没揭示到 → 不出题
  assert.equal(pendingDecision(plan, 2, 1), null)
})

test('revealAnnotationFor / replayVerdict：揭晓标注与判题', () => {
  const plan = replayPlan(replaySpec(), REPLAY_BARS)
  assert.ok(plan)
  const first = plan.points[0]!.decision
  assert.equal(revealAnnotationFor(plan, first)?.annotation.label, '回踩不破')
  assert.equal(replayVerdict(first, '持有').correct, true)
  assert.equal(replayVerdict(first, '减仓').correct, false)
  assert.equal(replayVerdict(first, '减仓').correctLabel, '持有')
})

test('branchingNodes / pathMatchesOptimal：走的路与最优路一致才算过', () => {
  const spec: WidgetSpec = {
    type: 'branching-scenario',
    specVersion: 1,
    citations: CITATIONS,
    assertions: { graphAcyclic: true, allPathsTerminate: true, optimalPathReachable: true, feedbackNonEmpty: true },
    scenario: '行情转弱怎么办？',
    nodes: [
      {
        id: 'n1',
        prompt: '先看什么？',
        options: [{ label: '看结构', next: 'n2', feedback: '结构优先' }],
      },
      {
        id: 'n2',
        prompt: '结构破了怎么办？',
        options: [{ label: '离场', next: null, feedback: '保住本金' }],
      },
    ],
    entryId: 'n1',
    optimalPath: ['n1', 'n2'],
  }
  assert.equal(branchingNodes(spec).length, 2)
  assert.equal(pathMatchesOptimal(spec, ['n1', 'n2']), true)
  assert.equal(pathMatchesOptimal(spec, ['n1']), false)
  assert.equal(pathMatchesOptimal(spec, ['n2', 'n1']), false)
})
