import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateBars, widgetSpec, type KlineBar, type WidgetSpec } from '@trend-suite/contracts'
import { proveAssertions, type WidgetAssertionDeps } from './assertions'

/**
 * 断言证明器的逐条用例（arch/06 §8）：24 条断言每条至少一例，
 * 「判得过」与「判不过」各占一半——判不过的一例尤其重要：
 * 断言宁可多报错也不放过（迭代 7 的底线）。
 *
 * 用例里的 spec 有两类：
 * - `specOf`：先过 v3 契约（形状不合的压根到不了证明器）；
 * - `rawSpec`：绕过契约直接构造，专测契约之外那道防线
 *   （如 conclusion 为空——契约已拒，但证明器仍须独立判不过）。
 */

const UNIT_ID = 'su_0123456789abcdef'
const FIGURE_ID = 'fig_0123456789abcdef'

const REPLAY_BARS: KlineBar[] = [
  { d: '2023-01-06', o: 100, h: 105, l: 99, c: 103, v: 1000 },
  { d: '2023-05-05', o: 110, h: 115, l: 109, c: 113, v: 1000 },
  { d: '2023-06-02', o: 120, h: 125, l: 119, c: 123, v: 1000 },
]

const DEPS: WidgetAssertionDeps = {
  terms: ['趋势', '级别'],
  units: new Map([[UNIT_ID, { assetId: 'ma_0123456789abcdef', startMs: 20000, endMs: 50000 }]]),
  figureIds: new Set([FIGURE_ID]),
  barsByCode: new Map([['600519', REPLAY_BARS]]),
}

const BASE = { specVersion: 1, citations: [UNIT_ID] }

/** 过 v3 契约的 spec（形状不合的到不了证明器）。 */
function specOf(value: unknown): WidgetSpec {
  const parsed = widgetSpec.safeParse(value)
  assert.ok(parsed.success, `spec 不合契约：${JSON.stringify(parsed.error?.issues)}`)
  return parsed.data
}

/** 绕过契约的 spec（专测契约之外那道防线）。 */
function rawSpec(value: unknown): WidgetSpec {
  return value as WidgetSpec
}

/** 指定断言不成立时，返回它的判定详情。 */
function verdictOf(spec: WidgetSpec, assertion: string, deps: WidgetAssertionDeps = DEPS): string {
  const result = proveAssertions(spec, deps)
  const failed = result.issues.find((issue) => issue.assertion === assertion)
  assert.ok(failed, `期望断言 ${assertion} 不成立，实际 issues=${JSON.stringify(result.issues)}`)
  return failed.detail ?? ''
}

/** 断言全部成立。 */
function allPass(spec: WidgetSpec, deps: WidgetAssertionDeps = DEPS): void {
  const result = proveAssertions(spec, deps)
  assert.deepEqual(result.issues, [], '断言应全部成立')
  assert.ok(result.proofs.every((proof) => proof.status === 'pass'))
}

// ---------------------------------------------------------------- 图表类断言

const KLINE_PASS = specOf({
  type: 'kline-annotator',
  ...BASE,
  data: { generator: 'uptrend', seed: 42, bars: 60 },
  task: '在周线图上画出趋势线',
  solution: { trendline: { startIdx: 0, endIdx: 20 } },
  assertions: {
    trendlineTouches: { min: 2 },
    slopeRange: { min: 0, max: 90 },
    noBreakBelow: true,
  },
})

test('trendlineTouches：触及根数够则成立，不够则不成立', () => {
  allPass(KLINE_PASS)
  const strict = specOf({
    ...KLINE_PASS,
    assertions: { trendlineTouches: { min: 30 } },
  })
  assert.match(verdictOf(strict, 'trendlineTouches'), /只触及/)
})

test('slopeRange：斜率角落在声明区间才成立', () => {
  allPass(KLINE_PASS)
  const narrow = specOf({
    ...KLINE_PASS,
    assertions: { slopeRange: { min: 80, max: 85 } },
  })
  assert.match(verdictOf(narrow, 'slopeRange'), /斜率角/)
})

test('noBreakBelow：锚点区间内收盘跌破趋势线即不成立', () => {
  allPass(KLINE_PASS)
  // 上行段的整段弦线在凸曲线上方，中间收盘必被跌破。
  const wide = specOf({
    ...KLINE_PASS,
    solution: { trendline: { startIdx: 0, endIdx: 59 } },
  })
  assert.match(verdictOf(wide, 'noBreakBelow'), /跌破/)
})

// ---------------------------------------------------------------- 题目类断言

const MCQ_PASS = specOf({
  type: 'mcq-quiz',
  ...BASE,
  question: '判断趋势延续的首要依据是什么？',
  options: [
    { id: 'a', label: '高点与低点依次抬升' },
    { id: 'b', label: '单根 K 线涨跌' },
  ],
  answerId: 'a',
  conceptRefs: ['趋势'],
  assertions: { answerUnique: true, termsInConcepts: true },
})

test('answerUnique：选项 id 唯一且含答案才成立', () => {
  allPass(MCQ_PASS)
  const duplicated = specOf({
    ...MCQ_PASS,
    options: [
      { id: 'a', label: '甲' },
      { id: 'a', label: '乙' },
    ],
  })
  assert.match(verdictOf(duplicated, 'answerUnique'), /重复/)
})

const PATTERN_PASS = specOf({
  type: 'pattern-quiz',
  ...BASE,
  data: { generator: 'uptrend', seed: 42, bars: 60 },
  question: '这是哪种形态？',
  options: [
    { id: 'a', label: '上升', generator: 'uptrend', seed: 42, bars: 60 },
    { id: 'b', label: '下降', generator: 'downtrend', seed: 42, bars: 60 },
    { id: 'c', label: '震荡', generator: 'range', seed: 42, bars: 60 },
  ],
  answerId: 'a',
  assertions: { answerUnique: true, distractorsDistinct: true, patternMatchesAnswer: 'uptrend' },
})

test('distractorsDistinct：各选项形态互异才成立', () => {
  allPass(PATTERN_PASS)
  const clash = specOf({
    ...PATTERN_PASS,
    options: [
      { id: 'a', label: '上升', generator: 'uptrend', seed: 42, bars: 60 },
      { id: 'b', label: '也是上升', generator: 'uptrend', seed: 42, bars: 60 },
      { id: 'c', label: '震荡', generator: 'range', seed: 42, bars: 60 },
    ],
  })
  assert.match(verdictOf(clash, 'distractorsDistinct'), /重复/)
})

test('patternMatchesAnswer：声明的形态与正确项实际形态一致才成立', () => {
  allPass(PATTERN_PASS)
  const wrong = specOf({
    ...PATTERN_PASS,
    assertions: { answerUnique: true, patternMatchesAnswer: 'downtrend' },
  })
  assert.match(verdictOf(wrong, 'patternMatchesAnswer'), /与声明的/)
})

// ---------------------------------------------------------------- 步骤类断言

const STEP_PASS = specOf({
  type: 'step-reveal',
  ...BASE,
  data: { generator: 'uptrend', seed: 42, bars: 60 },
  steps: [
    {
      title: '第一段',
      fromIdx: 0,
      toIdx: 19,
      markers: [{ idx: 5, price: generateBars('uptrend', 42, 60)[5]!.c }],
      conclusion: '重心逐级抬升',
    },
    { title: '第二段', fromIdx: 20, toIdx: 39, conclusion: '趋势延续' },
  ],
  finalConclusion: '趋势由高低点序列刻画',
  assertions: { markersInRange: true, conclusionsNonEmpty: true },
})

test('markersInRange：窗口单调不重叠且标记价落位才成立', () => {
  allPass(STEP_PASS)
  const offPrice = specOf({
    ...STEP_PASS,
    steps: [
      {
        title: '第一段',
        fromIdx: 0,
        toIdx: 19,
        markers: [{ idx: 5, price: 9999 }],
        conclusion: '重心逐级抬升',
      },
      { title: '第二段', fromIdx: 20, toIdx: 39, conclusion: '趋势延续' },
    ],
  })
  assert.match(verdictOf(offPrice, 'markersInRange'), /标记价/)

  const overlapped = specOf({
    ...STEP_PASS,
    steps: [
      { title: '第一段', fromIdx: 0, toIdx: 19, conclusion: '重心逐级抬升' },
      { title: '第二段', fromIdx: 10, toIdx: 39, conclusion: '趋势延续' },
    ],
  })
  assert.match(verdictOf(overlapped, 'markersInRange'), /重叠/)
})

test('conclusionsNonEmpty：结论为空即不成立（契约之外的防线）', () => {
  allPass(STEP_PASS)
  const empty = rawSpec({
    ...STEP_PASS,
    steps: [{ title: '第一段', fromIdx: 0, toIdx: 19, conclusion: '' }],
    finalConclusion: '',
  })
  assert.match(verdictOf(empty, 'conclusionsNonEmpty'), /结论为空/)
})

// ---------------------------------------------------------------- 计算类断言

const CALC_PASS = specOf({
  type: 'calc-trainer',
  ...BASE,
  formula: 'risk-reward',
  inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 },
  examples: [{ inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 }, answer: 3 }],
  assertions: { examplesRecomputable: true, paramsInBounds: true },
})

test('examplesRecomputable：示例答案须能被公式复算出来', () => {
  allPass(CALC_PASS)
  const wrong = specOf({
    ...CALC_PASS,
    examples: [{ inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 }, answer: 5 }],
  })
  assert.match(verdictOf(wrong, 'examplesRecomputable'), /复算得/)
})

test('paramsInBounds：inputs 与示例参数须落在公式域内', () => {
  allPass(CALC_PASS)
  const outOfDomain = specOf({
    ...CALC_PASS,
    inputs: { entryPrice: 90, stopPrice: 100, targetPrice: 130 },
  })
  assert.match(verdictOf(outOfDomain, 'paramsInBounds'), /越出/)
})

// ---------------------------------------------------------------- 术语类断言

test('termsInConcepts：术语引用须落在概念表内', () => {
  allPass(MCQ_PASS)
  const unknown = specOf({ ...MCQ_PASS, conceptRefs: ['均线'] })
  assert.match(verdictOf(unknown, 'termsInConcepts'), /不在本课程概念表/)

  const card = specOf({
    type: 'flashcards',
    ...BASE,
    cards: [
      { front: '趋势是什么？', back: '价格的运行方向', conceptRef: '趋势' },
      { front: '级别是什么？', back: '时间尺度', conceptRef: '级别' },
      { front: '回撤是什么？', back: '回落幅度', conceptRef: '趋势' },
    ],
    assertions: { termsInConcepts: true, cardCount: { min: 3, max: 20 } },
  })
  allPass(card)
  const badCard = specOf({
    ...card,
    cards: [
      { front: '趋势是什么？', back: '价格的运行方向', conceptRef: '趋势' },
      { front: '级别是什么？', back: '时间尺度', conceptRef: '级别' },
      { front: '均线是什么？', back: '平均成本', conceptRef: '均线' },
    ],
  })
  assert.match(verdictOf(badCard, 'termsInConcepts'), /不在本课程概念表/)
})

test('cardCount：卡片数须落在声明区间内', () => {
  const card = specOf({
    type: 'flashcards',
    ...BASE,
    cards: [
      { front: '甲', back: 'A', conceptRef: '趋势' },
      { front: '乙', back: 'B', conceptRef: '趋势' },
      { front: '丙', back: 'C', conceptRef: '趋势' },
    ],
    assertions: { termsInConcepts: true, cardCount: { min: 3, max: 20 } },
  })
  allPass(card)
  const strict = specOf({ ...card, assertions: { termsInConcepts: true, cardCount: { min: 5, max: 20 } } })
  assert.match(verdictOf(strict, 'cardCount'), /卡片数/)
})

test('itemsNonEmpty：清单至少 3 条且每条非空', () => {
  const list = specOf({
    type: 'checklist',
    ...BASE,
    title: '趋势判断自检清单',
    items: [
      { text: '周期是否统一', conceptRef: '级别' },
      { text: '高低点是否依次抬升', conceptRef: '趋势' },
      { text: '级别信号是否互相印证' },
    ],
    assertions: { itemsNonEmpty: true, termsInConcepts: true },
  })
  allPass(list)
  const empty = rawSpec({
    ...list,
    items: [{ text: '周期是否统一' }, { text: '' }, { text: '级别信号是否互相印证' }],
  })
  assert.match(verdictOf(empty, 'itemsNonEmpty'), /为空/)
})

// ---------------------------------------------------------------- 图谱类断言

const TIMELINE_PASS = specOf({
  type: 'timeline-explorer',
  ...BASE,
  nodes: [{ conceptRef: '级别' }, { conceptRef: '趋势' }],
  edges: [{ from: '级别', to: '趋势', kind: 'prerequisite' }],
  assertions: { edgeRefsExist: true, acyclicPrerequisite: true },
})

test('edgeRefsExist：节点与边的概念须存在且边端点在节点列表内', () => {
  allPass(TIMELINE_PASS)
  const dangling = specOf({
    ...TIMELINE_PASS,
    edges: [{ from: '级别', to: '均线', kind: 'prerequisite' }],
  })
  assert.match(verdictOf(dangling, 'edgeRefsExist'), /不在本课程概念表/)

  const outside = specOf({
    ...TIMELINE_PASS,
    nodes: [{ conceptRef: '级别' }],
    edges: [{ from: '级别', to: '趋势', kind: 'prerequisite' }],
  })
  assert.match(verdictOf(outside, 'edgeRefsExist'), /节点列表内/)
})

test('acyclicPrerequisite：先修子图不得有环', () => {
  allPass(TIMELINE_PASS)
  const cyclic = specOf({
    ...TIMELINE_PASS,
    edges: [
      { from: '级别', to: '趋势', kind: 'prerequisite' },
      { from: '趋势', to: '级别', kind: 'prerequisite' },
    ],
  })
  assert.match(verdictOf(cyclic, 'acyclicPrerequisite'), /有环/)
})

// ---------------------------------------------------------------- 对照图断言

const JUXTA_PASS = specOf({
  type: 'image-juxtaposition',
  ...BASE,
  left: { figureId: FIGURE_ID },
  right: { figureId: FIGURE_ID },
  labels: { left: '密集', right: '发散' },
  captions: { left: '筹码密集时的趋势结构', right: '筹码发散后的趋势结构' },
  assertions: { pairSidesValid: true, captionsGrounded: true },
})

test('pairSidesValid：figureId 须在本节图示集内', () => {
  allPass(JUXTA_PASS)
  const unknown = specOf({
    ...JUXTA_PASS,
    right: { figureId: 'fig_ffffffffffffffff' },
  })
  assert.match(verdictOf(unknown, 'pairSidesValid'), /不在本节图示集内/)
})

test('captionsGrounded：两侧 caption 都须含概念词', () => {
  allPass(JUXTA_PASS)
  const ungrounded = specOf({
    ...JUXTA_PASS,
    captions: { left: '随便写写', right: '也随便写写' },
  })
  assert.match(verdictOf(ungrounded, 'captionsGrounded'), /未包含任何概念词/)
})

// ---------------------------------------------------------------- 分支情景断言

const BRANCH_PASS = specOf({
  type: 'branching-scenario',
  ...BASE,
  scenario: '趋势延续还是反转？',
  nodes: [
    {
      id: 'n1',
      prompt: '这一段之后怎么办？',
      options: [
        { label: '顺势持有', next: 'n2', feedback: '顺势是对的' },
        { label: '立即离场', next: null, feedback: '离场太早' },
      ],
    },
    {
      id: 'n2',
      prompt: '回踩前低怎么办？',
      options: [{ label: '继续持有', next: null, feedback: '回踩不破前低' }],
    },
  ],
  entryId: 'n1',
  optimalPath: ['n1', 'n2'],
  assertions: {
    graphAcyclic: true,
    allPathsTerminate: true,
    optimalPathReachable: true,
    feedbackNonEmpty: true,
  },
})

test('graphAcyclic：决策图不得有环', () => {
  allPass(BRANCH_PASS)
  const cyclic = specOf({
    ...BRANCH_PASS,
    nodes: [
      {
        id: 'n1',
        prompt: '怎么办？',
        options: [{ label: '去 n2', next: 'n2', feedback: 'x' }],
      },
      {
        id: 'n2',
        prompt: '怎么办？',
        options: [{ label: '回 n1', next: 'n1', feedback: 'x' }],
      },
    ],
    optimalPath: ['n1'],
  })
  assert.match(verdictOf(cyclic, 'graphAcyclic'), /有环/)
})

test('allPathsTerminate：每个可达节点都要能走到终点', () => {
  allPass(BRANCH_PASS)
  // 走到 n2 就断了：n2 没有任何可结束选项（契约要求 options ≥1，此处绕过契约测防线）。
  const deadEnd = rawSpec({
    ...BRANCH_PASS,
    nodes: [
      {
        id: 'n1',
        prompt: '怎么办？',
        options: [{ label: '去 n2', next: 'n2', feedback: 'x' }],
      },
      { id: 'n2', prompt: '怎么办？', options: [] },
    ],
    optimalPath: ['n1'],
  })
  assert.match(verdictOf(deadEnd, 'allPathsTerminate'), /无法走到可结束节点/)
})

test('optimalPathReachable：最优路径须自入口连通到可结束节点', () => {
  allPass(BRANCH_PASS)
  const broken = specOf({ ...BRANCH_PASS, optimalPath: ['n1', 'n9'] })
  assert.match(verdictOf(broken, 'optimalPathReachable'), /断开/)
})

test('feedbackNonEmpty：每个选项都要有反馈', () => {
  allPass(BRANCH_PASS)
  const empty = rawSpec({
    ...BRANCH_PASS,
    nodes: [
      {
        id: 'n1',
        prompt: '怎么办？',
        options: [{ label: '离场', next: null, feedback: '' }],
      },
    ],
    optimalPath: ['n1'],
  })
  assert.match(verdictOf(empty, 'feedbackNonEmpty'), /反馈为空/)
})

// ---------------------------------------------------------------- 回放课件断言

/** 回放课件的 spec 变体（判别联合收窄后才有 decisions/annotations）。 */
type ReplaySpec = Extract<WidgetSpec, { type: 'bar-replay-decision' }>

const REPLAY_PASS = specOf({
  type: 'bar-replay-decision',
  ...BASE,
  code: '600519',
  window: { from: '2023-01-01', to: '2023-12-31' },
  period: '1w',
  annotations: [
    { unitId: UNIT_ID, atMs: 30000, kind: 'structure', d: '2023-06-02', label: '周线级别抬升的高点' },
  ],
  decisions: [
    {
      atDate: '2023-05-05',
      question: '趋势是延续还是反转？',
      options: [{ label: '延续' }, { label: '反转' }],
      correct: '延续',
      revealText: '后市重心继续上移，趋势被验证。',
      unitId: UNIT_ID,
      atMs: 30000,
    },
  ],
  assertions: {
    answerUnique: true,
    decisionPointsGrounded: true,
    revealMonotonic: true,
    annotationTermsGrounded: true,
  },
}) as ReplaySpec

test('answerUnique（回放）：correct 须恰命中一个选项文案', () => {
  allPass(REPLAY_PASS)
  const ambiguous = specOf({
    ...REPLAY_PASS,
    decisions: [
      {
        ...REPLAY_PASS.decisions[0]!,
        options: [{ label: '延续' }, { label: '延续' }],
      },
    ],
  })
  assert.match(verdictOf(ambiguous, 'answerUnique'), /命中/)
})

test('decisionPointsGrounded：单元/atMs/日期接地三关都得过', () => {
  allPass(REPLAY_PASS)
  const badUnit = specOf({
    ...REPLAY_PASS,
    annotations: [{ ...REPLAY_PASS.annotations[0]!, unitId: 'su_ffffffffffffffff' }],
  })
  assert.match(verdictOf(badUnit, 'decisionPointsGrounded'), /不存在/)

  const badAtMs = specOf({
    ...REPLAY_PASS,
    annotations: [{ ...REPLAY_PASS.annotations[0]!, atMs: 999999 }],
  })
  assert.match(verdictOf(badAtMs, 'decisionPointsGrounded'), /素材单元窗/)

  const notTradingDay = specOf({
    ...REPLAY_PASS,
    annotations: [{ ...REPLAY_PASS.annotations[0]!, d: '2023-05-06' }],
  })
  assert.match(verdictOf(notTradingDay, 'decisionPointsGrounded'), /交易日/)
})

test('revealMonotonic：判断点日期须严格递增且之后有可揭晓标注', () => {
  allPass(REPLAY_PASS)
  const backInTime = specOf({
    ...REPLAY_PASS,
    decisions: [
      REPLAY_PASS.decisions[0]!,
      { ...REPLAY_PASS.decisions[0]!, atDate: '2023-01-06' },
    ],
  })
  assert.match(verdictOf(backInTime, 'revealMonotonic'), /严格递增/)
})

test('annotationTermsGrounded：揭晓文案须含概念词', () => {
  allPass(REPLAY_PASS)
  const ungrounded = specOf({
    ...REPLAY_PASS,
    decisions: [{ ...REPLAY_PASS.decisions[0]!, revealText: '后市就这样。' }],
  })
  assert.match(verdictOf(ungrounded, 'annotationTermsGrounded'), /未包含任何概念词/)
})
