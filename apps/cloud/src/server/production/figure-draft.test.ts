import { test } from 'node:test'
import assert from 'node:assert/strict'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { buildStepTool } from './agent'
import type { ProductionTaskRow } from './repo'

/**
 * 第 4 步的图示草稿形状（arch/05 §8）：
 * 端到端实测暴露——草稿 schema 原本是 `params: record<string, unknown>`，
 * 形状只写在提示词散文里，模型看不见就乱填（items 写成对象、leftCount 写成字符串），
 * 服务端复检必然拒绝，三次回灌后转人工。
 *
 * 修法：diagram 的 params 就是模板参数形状本身（契约包单一真相源），于是
 * **模型看得见**——这里断言的是「模型收到的那份 JSON schema」。
 */

function step4Task(): ProductionTaskRow {
  const now = new Date()
  return {
    id: 'tsk_test',
    course_id: 'crs_test',
    section_id: '1-1',
    step: 4,
    status: 'running',
    attempts: 0,
    last_error: null,
    checkpoint: {},
    heartbeat_at: null,
    created_at: now,
    updated_at: now,
  }
}

function toolJsonSchema(): Record<string, unknown> {
  const tool = buildStepTool(step4Task())
  const converted = convertToOpenAITool(tool) as unknown as {
    function: { parameters: Record<string, unknown> }
  }
  return converted.function.parameters
}

test('模型看到的工具 schema 里含模板参数的字段与取值域', () => {
  const schema = JSON.stringify(toolJsonSchema())
  assert.ok(schema.includes('chip-contrast'), '模板白名单在 schema 里')
  assert.ok(schema.includes('leftCount'), 'chip-contrast 的 leftCount 在 schema 里')
  assert.ok(schema.includes('rightLabel'), 'chip-contrast 的 rightLabel 在 schema 里')
  assert.ok(schema.includes('stat-inline'), 'stat-inline 在 schema 里')
  // params 不再是自由键值对：形状必须展开成具体字段。
  assert.ok(!schema.includes('"additionalProperties":true'), 'params 不该退化成自由键值对')
})

test('第一步层就拒掉形状错的图示产物（数组写成对象、数字写成字符串）', () => {
  const tool = buildStepTool(step4Task())
  const schema = tool.schema as { safeParse: (v: unknown) => { success: boolean } }

  const itemsAsObject = schema.safeParse({
    product: {
      figures: [
        {
          kind: 'diagram',
          caption: '三种趋势下的操作力度',
          template: 'stat-inline',
          params: { items: { label: '最大回撤', value: '12%' } },
        },
      ],
    },
  })
  assert.equal(itemsAsObject.success, false, 'items 是对象不是数组 → 第一层就拒')

  const countAsString = schema.safeParse({
    product: {
      figures: [
        {
          kind: 'diagram',
          caption: '顺势与逆势对照',
          template: 'chip-contrast',
          params: {
            title: '顺势 vs 逆势',
            leftLabel: '顺势',
            rightLabel: '逆势',
            leftCount: '12',
            rightCount: 8,
          },
        },
      ],
    },
  })
  assert.equal(countAsString.success, false, 'leftCount 是字符串不是数字 → 第一层就拒')

  const ok = schema.safeParse({
    product: {
      figures: [
        {
          kind: 'diagram',
          caption: '顺势与逆势对照',
          template: 'chip-contrast',
          params: {
            title: '顺势 vs 逆势',
            leftLabel: '顺势',
            rightLabel: '逆势',
            leftCount: 12,
            rightCount: 8,
          },
        },
      ],
    },
  })
  assert.equal(ok.success, true, '形状对就过')
})
