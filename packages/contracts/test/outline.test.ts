import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchOutlineLevel, normalizeOutlineText, parseOutlineText } from '../src/index.js'

/** 目录先验格式规则：前后端共用（教师端本地提示与一键规整、服务端把关同源）。 */

test('matchOutlineLevel：识别三级编号', () => {
  assert.equal(matchOutlineLevel('第一篇 总论'), 1)
  assert.equal(matchOutlineLevel('第一章 什么是趋势'), 2)
  assert.equal(matchOutlineLevel('一、趋势'), 2)
  assert.equal(matchOutlineLevel('1. 趋势的定义'), 3)
  assert.equal(matchOutlineLevel('1.1 趋势的定义'), 3)
  assert.equal(matchOutlineLevel('这不是目录'), null)
})

test('parseOutlineText：解析成目录树并给出行号', () => {
  const { nodes, issues } = parseOutlineText(
    ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义', '2. 级别的概念'].join('\n'),
  )

  assert.equal(issues.length, 0)
  assert.equal(nodes.length, 4)
  assert.equal(nodes[0]?.level, 1)
  assert.equal(nodes[1]?.parentId, nodes[0]?.id)
  assert.equal(nodes[2]?.level, 3)
})

test('parseOutlineText：认不出的行给原文行号与非空序号', () => {
  const { nodes, issues } = parseOutlineText('第一篇 总论\n这不是目录\n')

  assert.equal(nodes.length, 1)
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.line, 2)
  assert.equal(issues[0]?.index, 2)
})

test('normalizeOutlineText：常见写法改写成认得的编号', () => {
  const normalized = normalizeOutlineText(
    ['第一部分 总论', '一. 什么是趋势', '1 趋势的定义', '（2）级别的概念'].join('\n'),
  )

  assert.equal(normalized, ['第一篇 总论', '一、什么是趋势', '1. 趋势的定义', '2. 级别的概念'].join('\n'))
  assert.equal(parseOutlineText(normalized).issues.length, 0)
})

test('normalizeOutlineText：已合规的行原样保留', () => {
  const text = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义'].join('\n')
  assert.equal(normalizeOutlineText(text), text)
})

test('normalizeOutlineText：无编号的行按上文顺推补编号', () => {
  const normalized = normalizeOutlineText(['第一篇 总论', '什么是趋势', '趋势的定义'].join('\n'))

  assert.equal(normalized, ['第一篇 总论', '第1章 什么是趋势', '1. 趋势的定义'].join('\n'))
  assert.equal(parseOutlineText(normalized).issues.length, 0)
})
