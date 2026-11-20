import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { buildStepTool } from './agent'
import type { ProductionTaskRow } from './repo'

/**
 * 第 5/7 步的课件草稿形状（arch/06 §8）：
 * 端到端实测暴露——草稿 schema 原本把 assertions 当自由键值对，模型看不见
 * `cardCount` 要 `{min,max}`，就把 cardCount 写成字符串 `"3-5"`，服务端复检拒绝，
 * 三次回灌后转人工。
 *
 * 修法：每类课件的断言表展开成「该类适用的断言 + 参数形状」（契约包单一真相源），
 * 于是**模型看得见**——这里断言的是「模型收到的那份 JSON schema」。
 */

function stepTask(step: number): ProductionTaskRow {
  const now = new Date()
  return {
    id: 'tsk_test',
    course_id: 'crs_test',
    section_id: '1-1',
    step,
    status: 'running',
    attempts: 0,
    last_error: null,
    checkpoint: {},
    heartbeat_at: null,
    created_at: now,
    updated_at: now,
  }
}

function toolJsonSchema(step: number): string {
  const tool = buildStepTool(stepTask(step))
  const converted = convertToOpenAITool(tool) as unknown as {
    function: { parameters: Record<string, unknown> }
  }
  return JSON.stringify(converted.function.parameters)
}

/** 在 JSON schema 里按键名深搜（anyOf 展开后的结构）。 */
function findByKey(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findByKey(item, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (key in record) return record[key]
    for (const value of Object.values(record)) {
      const found = findByKey(value, key)
      if (found !== undefined) return found
    }
  }
  return undefined
}

test('模型看到的工具 schema 里含断言名与参数形状', () => {
  const schema = toolJsonSchema(7)
  assert.ok(schema.includes('cardCount'), 'cardCount 在 schema 里')
  assert.ok(schema.includes('termsInConcepts'), 'termsInConcepts 在 schema 里')
  assert.ok(schema.includes('answerUnique'), 'answerUnique 在 schema 里')

  // cardCount 的参数是对象且有 min/max——模型看得见要给两个数。
  const cardCount = findByKey(JSON.parse(schema), 'cardCount')
  assert.ok(cardCount, 'cardCount 在 schema 里是个对象')
  const properties = (cardCount as { properties?: Record<string, unknown> }).properties
  assert.ok(properties && 'min' in properties && 'max' in properties, 'cardCount 有 min/max')
  // 断言表不该退化成自由键值对。
  assert.ok(!schema.includes('"additionalProperties":true'), 'assertions 不该退化成自由键值对')
})

test('第一步层就拒掉形状错的断言参数（cardCount 写成字符串）', () => {
  const tool = buildStepTool(stepTask(7))
  const schema = tool.schema as { safeParse: (v: unknown) => { success: boolean } }

  const cards = [
    { front: '趋势是什么？', back: '价格的运行方向', conceptRef: '趋势' },
    { front: '级别是什么？', back: '时间尺度', conceptRef: '级别' },
    { front: '回撤是什么？', back: '回落幅度', conceptRef: '趋势' },
  ]

  const bad = schema.safeParse({
    product: {
      widgets: [
        {
          type: 'flashcards',
          citations: ['su_0123456789abcdef'],
          assertions: { cardCount: '3-5' },
          cards,
        },
      ],
    },
  })
  assert.equal(bad.success, false, 'cardCount 是字符串 → 第一层就拒')

  const notApplicable = schema.safeParse({
    product: {
      widgets: [
        {
          type: 'mcq-quiz',
          citations: ['su_0123456789abcdef'],
          assertions: { cardCount: { min: 3, max: 20 } },
          question: '判断趋势延续的首要依据是什么？',
          options: [
            { id: 'a', label: '高点与低点依次抬升' },
            { id: 'b', label: '单根 K 线涨跌' },
          ],
          answerId: 'a',
          conceptRefs: ['趋势'],
        },
      ],
    },
  })
  assert.equal(notApplicable.success, false, 'mcq-quiz 不适用 cardCount → 第一层就拒')

  const ok = schema.safeParse({
    product: {
      widgets: [
        {
          type: 'flashcards',
          citations: ['su_0123456789abcdef'],
          assertions: { termsInConcepts: true, cardCount: { min: 3, max: 20 } },
          cards,
        },
      ],
    },
  })
  assert.equal(ok.success, true, '形状对就过')
})
