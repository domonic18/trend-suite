import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSERTION_NAMES,
  applicableAssertions,
  assertionsForType,
  widgetDraft,
} from '../src/index.js'

/**
 * 断言参数形状（arch/06 §8）：
 * - **模型看得见**：草稿里每类课件的 assertions 展开成该类适用的断言与参数形状，
 *   模型不会把 cardCount 写成字符串 `"3-5"`（端到端实测踩过：形状只写在提示词
 *   散文里，模型看不见就乱填，服务端复检必然拒绝）；
 * - **单一真相源**：参数形状只有一份定义（widget-assertions.ts），草稿契约与服务端
 *   复检共用。
 */

const UNIT_ID = 'su_0123456789abcdef'

const FLASHCARDS = {
  type: 'flashcards',
  citations: [UNIT_ID],
  cards: [
    { front: '趋势是什么？', back: '价格的运行方向', conceptRef: '趋势' },
    { front: '级别是什么？', back: '时间尺度', conceptRef: '级别' },
    { front: '回撤是什么？', back: '回落幅度', conceptRef: '趋势' },
  ],
}

const MCQ = {
  type: 'mcq-quiz',
  citations: [UNIT_ID],
  question: '判断趋势延续的首要依据是什么？',
  options: [
    { id: 'a', label: '高点与低点依次抬升' },
    { id: 'b', label: '单根 K 线涨跌' },
  ],
  answerId: 'a',
  conceptRefs: ['趋势'],
}

test('每类课件的断言表只含该类适用的断言', () => {
  for (const type of ['kline-annotator', 'mcq-quiz', 'flashcards', 'bar-replay-decision'] as const) {
    const names = applicableAssertions(type)
    assert.ok(names.length > 0, `${type} 至少一条适用断言`)
    for (const name of names) {
      assert.ok((ASSERTION_NAMES as readonly string[]).includes(name), `${name} 在断言词表里`)
    }
  }
  assert.deepEqual(applicableAssertions('flashcards').sort(), ['cardCount', 'termsInConcepts'])
  assert.ok(!applicableAssertions('mcq-quiz').includes('cardCount'))
})

test('草稿接受形状对的断言参数（cardCount 是对象、answerUnique 是 true）', () => {
  const ok = widgetDraft.safeParse({
    ...FLASHCARDS,
    assertions: { termsInConcepts: true, cardCount: { min: 3, max: 20 } },
  })
  assert.equal(ok.success, true, JSON.stringify(ok.error?.issues))

  const mcq = widgetDraft.safeParse({
    ...MCQ,
    assertions: { answerUnique: true, termsInConcepts: true },
  })
  assert.equal(mcq.success, true, JSON.stringify(mcq.error?.issues))
})

test('草稿拒掉形状错的断言参数：cardCount 写成字符串', () => {
  const result = widgetDraft.safeParse({
    ...FLASHCARDS,
    assertions: { cardCount: '3-5' },
  })
  assert.equal(result.success, false, 'cardCount 是字符串 → 拒')
})

test('草稿拒掉不适用于该组件的断言与未知断言名', () => {
  const notApplicable = widgetDraft.safeParse({
    ...MCQ,
    assertions: { cardCount: { min: 3, max: 20 } },
  })
  assert.equal(notApplicable.success, false, 'mcq-quiz 不适用 cardCount → 拒')

  const unknown = widgetDraft.safeParse({
    ...MCQ,
    assertions: { 不是断言: true },
  })
  assert.equal(unknown.success, false, '未知断言名 → 拒')
})

test('断言表形状：每类课件的断言键与其参数形状一一对应', () => {
  const shape = assertionsForType('flashcards') as unknown as {
    shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }>
  }
  assert.deepEqual(Object.keys(shape.shape).sort(), ['cardCount', 'termsInConcepts'])
  assert.equal(shape.shape.cardCount?.safeParse({ min: 3, max: 20 }).success, true)
  assert.equal(shape.shape.cardCount?.safeParse({ min: 3, max: 20, extra: 1 }).success, false)
  assert.equal(shape.shape.termsInConcepts?.safeParse(true).success, true)
  assert.equal(shape.shape.termsInConcepts?.safeParse('yes').success, false)
})
