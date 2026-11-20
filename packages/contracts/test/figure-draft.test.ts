import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIAGRAM_TEMPLATE_NAMES,
  diagramParamsByTemplate,
  figureDraftProduct,
} from '../src/index.js'

/**
 * 图示草稿与模板参数形状（arch/05 §8）：
 * - **模型看得见**：草稿里 diagram 的 params 就是模板参数形状本身，形状错了第一层就拒；
 * - **单一真相源**：参数形状只有一份定义（figure-params.ts），服务端复检与 agent 草稿共用。
 */

const FIXTURES: Record<string, Record<string, unknown>> = {
  'chip-contrast': {
    title: '筹码密集 vs 发散',
    leftLabel: '密集筹码',
    rightLabel: '发散筹码',
    leftCount: 12,
    rightCount: 8,
  },
  'chip-horizontal': {
    title: '三种趋势的操作力度',
    priceLabel: '价位',
    rows: [
      { y: 20, width: 80, label: '顺势持有' },
      { y: 60, width: 50, label: '震荡降频' },
    ],
  },
  timeline: {
    title: '趋势确认三步',
    events: [
      { label: '破位', desc: '高点抬高' },
      { label: '回踩', desc: '不破前高' },
    ],
  },
  'stat-inline': {
    items: [
      { label: '最大回撤', value: '12%' },
      { label: '盈亏比', value: '3.0' },
    ],
  },
}

test('每个模板都有一份参数形状与 fixture（扩模板必须同时给形状）', () => {
  assert.deepEqual([...DIAGRAM_TEMPLATE_NAMES].sort(), Object.keys(diagramParamsByTemplate).sort())
  for (const template of DIAGRAM_TEMPLATE_NAMES) {
    const parsed = diagramParamsByTemplate[template].safeParse(FIXTURES[template])
    assert.equal(parsed.success, true, `${template} 的 fixture 应过参数形状`)
  }
})

test('草稿接受形状正确的 diagram（模型按工具 schema 填即可）', () => {
  const result = figureDraftProduct.safeParse({
    figures: [
      {
        kind: 'diagram',
        caption: '密集与发散筹码对比',
        template: 'chip-contrast',
        params: FIXTURES['chip-contrast'],
      },
    ],
  })
  assert.equal(result.success, true)
})

test('草稿拒掉形状错的 diagram：数组写成对象、数字写成字符串', () => {
  const itemsAsObject = figureDraftProduct.safeParse({
    figures: [
      {
        kind: 'diagram',
        caption: '三种趋势下的操作力度',
        template: 'stat-inline',
        params: { items: { label: '最大回撤', value: '12%' } },
      },
    ],
  })
  assert.equal(itemsAsObject.success, false, 'items 是对象不是数组 → 拒')

  const countAsString = figureDraftProduct.safeParse({
    figures: [
      {
        kind: 'diagram',
        caption: '顺势与逆势对照',
        template: 'chip-contrast',
        params: { ...FIXTURES['chip-contrast'], leftCount: '12' },
      },
    ],
  })
  assert.equal(countAsString.success, false, 'leftCount 是字符串不是数字 → 拒')
})

test('草稿拒掉未知模板与多余字段', () => {
  const unknownTemplate = figureDraftProduct.safeParse({
    figures: [
      {
        kind: 'diagram',
        caption: '随便什么',
        template: 'mermaid',
        params: { code: 'graph TD;' },
      },
    ],
  })
  assert.equal(unknownTemplate.success, false)

  const extraKey = figureDraftProduct.safeParse({
    figures: [
      {
        kind: 'diagram',
        caption: '密集与发散筹码对比',
        template: 'chip-contrast',
        params: { ...FIXTURES['chip-contrast'], color: 'red' },
      },
    ],
  })
  assert.equal(extraKey.success, false, 'params 里多一个键 → 拒')
})
