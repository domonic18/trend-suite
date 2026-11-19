import { test } from 'node:test'
import assert from 'node:assert/strict'
import { widgetDraft, widgetSpec, classifyShape, generateBars } from '@trend-suite/contracts'
import { deriveSeed, materializeWidget } from './materialize'

/**
 * 草稿物化（arch/06 §9）：agent 的语义草稿 → 可入库的完整 spec。
 * 物化只补机械件（必带断言的缺省参数、干扰项的生成器参数），
 * 绝不替模型编内容——补不上的（未知断言、不适用断言、形状不合）一律拒。
 */

const UNIT_ID = 'su_0123456789abcdef'
const BASE = { citations: [UNIT_ID], assertions: {} }

const MCQ_DRAFT = {
  type: 'mcq-quiz',
  ...BASE,
  question: '判断趋势延续的首要依据是什么？',
  options: [
    { id: 'a', label: '高点与低点依次抬升' },
    { id: 'b', label: '单根 K 线涨跌' },
  ],
  answerId: 'a',
  conceptRefs: ['趋势'],
}

/** 物化成功的快捷方式。 */
function ok(draft: unknown): NonNullable<ReturnType<typeof materializeWidget>['spec']> {
  const result = materializeWidget(draft)
  assert.deepEqual(result.issues, [], '物化不应有问题')
  assert.ok(result.spec, '物化应产出 spec')
  return result.spec
}

test('物化补齐必带断言的缺省参数（声明了的原样保留）', () => {
  const spec = ok(MCQ_DRAFT)
  assert.deepEqual(spec.assertions, { answerUnique: true, termsInConcepts: true })
  assert.equal(spec.specVersion, 1)
})

test('作者声明的断言参数原样保留（作者的选择，判不过即回灌）', () => {
  const spec = ok({
    ...MCQ_DRAFT,
    assertions: { answerUnique: true, termsInConcepts: true },
  })
  assert.equal(spec.assertions.answerUnique, true)
})

test('未知断言名直接拒', () => {
  const result = materializeWidget({ ...MCQ_DRAFT, assertions: { 不是断言: true } })
  assert.equal(result.spec, null)
  assert.equal(result.issues[0]?.code, 'widget_spec_invalid')
  assert.match(result.issues[0]?.message ?? '', /未知断言名/)
})

test('不适用于该组件的断言直接拒', () => {
  const result = materializeWidget({ ...MCQ_DRAFT, assertions: { cardCount: { min: 3, max: 20 } } })
  assert.equal(result.spec, null)
  assert.equal(result.issues[0]?.code, 'assertion_not_applicable')
})

test('断言参数形状不合约定直接拒', () => {
  const result = materializeWidget({ ...MCQ_DRAFT, assertions: { answerUnique: 'yes' } })
  assert.equal(result.spec, null)
  assert.equal(result.issues[0]?.code, 'widget_spec_invalid')
  assert.match(result.issues[0]?.message ?? '', /参数形状不合/)
})

test('草稿形状不合约定直接拒（K 线数值没有位置——铁律）', () => {
  const result = materializeWidget({
    type: 'kline-annotator',
    ...BASE,
    data: { generator: 'uptrend', seed: 42, bars: [
      { d: '2023-01-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] },
    task: '画趋势线',
    solution: { trendline: { startIdx: 0, endIdx: 10 } },
  })
  assert.equal(result.spec, null)
  assert.equal(result.issues[0]?.code, 'widget_spec_invalid')
})

test('pattern-quiz 未声明生成器的干扰项按「形态互不相同」确定性补齐', () => {
  const spec = ok({
    type: 'pattern-quiz',
    ...BASE,
    data: { generator: 'uptrend', seed: 42, bars: 60 },
    question: '这是哪种形态？',
    options: [
      { id: 'a', label: '上升' },
      { id: 'b', label: '下降' },
      { id: 'c', label: '震荡' },
    ],
    answerId: 'a',
  })
  if (spec.type !== 'pattern-quiz') throw new Error('物化结果不是 pattern-quiz')
  const shapes = spec.options.map((option) =>
    classifyShape(generateBars(option.generator!, option.seed!, option.bars!)),
  )
  assert.equal(new Set(shapes).size, shapes.length, '各选项形态互不相同')
  assert.equal(shapes[0], 'uptrend', '正确项形态与题目声明一致')
})

test('补齐是确定性的：同一草稿两次物化结果逐字节一致（可重放）', () => {
  const draft = {
    type: 'pattern-quiz',
    ...BASE,
    data: { generator: 'uptrend', seed: 42, bars: 60 },
    question: '这是哪种形态？',
    options: [
      { id: 'a', label: '上升' },
      { id: 'b', label: '下降' },
    ],
    answerId: 'a',
  }
  assert.deepEqual(ok(draft), ok(draft))
})

test('种子由选项 id 确定性派生（同草稿必得同一 seed）', () => {
  assert.equal(deriveSeed('a:uptrend'), deriveSeed('a:uptrend'))
  assert.notEqual(deriveSeed('a:uptrend'), deriveSeed('b:uptrend'))
  assert.ok(deriveSeed('a:uptrend') >= 0)
})

test('v4 草稿 ↔ v3 spec 交叉：同一份 fixture 两边都过（字段名不漂移）', () => {
  // 迭代 6 的教训：校验器与渲染器各写一套字段名 → 服务端判过、客户端渲染不出。
  // 这里用一份 fixture 同时过 v4 草稿与 v3 spec，字段名漂移会当场炸出来。
  const fixtures: unknown[] = [
    MCQ_DRAFT,
    {
      type: 'pattern-quiz',
      ...BASE,
      data: { generator: 'uptrend', seed: 42, bars: 60 },
      question: '这是哪种形态？',
      options: [
        { id: 'a', label: '上升', generator: 'uptrend', seed: 42, bars: 60 },
        { id: 'b', label: '下降', generator: 'downtrend', seed: 7, bars: 60 },
      ],
      answerId: 'a',
    },
    {
      type: 'kline-annotator',
      ...BASE,
      data: { generator: 'uptrend', seed: 42, bars: 60 },
      task: '在周线图上画出趋势线',
      solution: { trendline: { startIdx: 0, endIdx: 20 } },
      annotations: [{ idx: 5, label: '高点', kind: 'structure' }],
    },
    {
      type: 'step-reveal',
      ...BASE,
      data: { generator: 'uptrend', seed: 42, bars: 60 },
      steps: [
        { title: '第一段', fromIdx: 0, toIdx: 19, conclusion: '重心抬升' },
        { title: '第二段', fromIdx: 20, toIdx: 39, conclusion: '趋势延续' },
      ],
      finalConclusion: '趋势由高低点序列刻画',
    },
    {
      type: 'calc-trainer',
      ...BASE,
      formula: 'risk-reward',
      inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 },
      examples: [{ inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 }, answer: 3 }],
    },
    {
      type: 'flashcards',
      ...BASE,
      cards: [
        { front: '趋势是什么？', back: '价格的运行方向', conceptRef: '趋势' },
        { front: '级别是什么？', back: '时间尺度', conceptRef: '级别' },
        { front: '回撤是什么？', back: '回落幅度', conceptRef: '趋势' },
      ],
    },
    {
      type: 'checklist',
      ...BASE,
      title: '趋势判断自检清单',
      items: [
        { text: '周期是否统一', conceptRef: '级别' },
        { text: '高低点是否依次抬升', conceptRef: '趋势' },
        { text: '级别信号是否互相印证' },
      ],
    },
    {
      type: 'timeline-explorer',
      ...BASE,
      nodes: [{ conceptRef: '级别' }, { conceptRef: '趋势' }],
      edges: [{ from: '级别', to: '趋势', kind: 'prerequisite' }],
    },
    {
      type: 'image-juxtaposition',
      ...BASE,
      left: { figureId: 'fig_0123456789abcdef' },
      right: { generator: 'uptrend', seed: 42, bars: 60 },
      labels: { left: '密集', right: '发散' },
      captions: { left: '密集时的趋势结构', right: '发散后的趋势结构' },
    },
    {
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
    },
    {
      type: 'bar-replay-decision',
      ...BASE,
      code: '600519',
      window: { from: '2023-01-01', to: '2023-12-31' },
      period: '1w',
      annotations: [
        { unitId: UNIT_ID, atMs: 30000, kind: 'structure', d: '2023-06-02', label: '抬升的高点' },
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
    },
  ]

  for (const fixture of fixtures) {
    const draft = widgetDraft.safeParse(fixture)
    assert.ok(draft.success, `草稿不合 v4 契约：${JSON.stringify(draft.error?.issues)}`)
    const spec = ok(draft.data)
    const parsed = widgetSpec.safeParse(spec)
    assert.ok(parsed.success, `spec 不合 v3 契约：${JSON.stringify(parsed.error?.issues)}`)
    // 字段名不漂移：v4 草稿与 v3 spec 的键集合必须一致（specVersion 由服务端补）。
    const specKeys = Object.keys(spec).filter((key) => key !== 'specVersion').sort()
    const draftKeys = Object.keys(draft.data).filter((key) => key !== 'specVersion').sort()
    assert.deepEqual(specKeys, draftKeys, '草稿与 spec 的字段名必须逐字一致')
  }
})
