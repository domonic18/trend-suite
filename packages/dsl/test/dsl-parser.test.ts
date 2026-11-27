import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DSL_VERSION } from '@trend-suite/contracts'
import { collectStockRefs, collectUnitRefs, DslSyntaxError, parseDsl } from '../src/dsl-parser'

/**
 * 教材 DSL 解析器（arch/06 §2 语法层）：块/属性/锚/散文合并/语法错——
 * 语义校验在 validator.test.ts。
 */

test('散文与容器块平铺成段，锚带行号', () => {
  const source = [
    '# 1. 趋势的定义',
    '',
    '趋势是方向，[[unit:su_a1|原片演示]] 里有逐笔讲解，对照 [[stock:600519|贵州茅台]] 看更清楚。',
    '',
    ':::think title=想一想',
    '横住算不算趋势？',
    ':::',
    '判断依据：先定级别再看方向。',
  ].join('\n')

  const ast = parseDsl(source)

  assert.equal(ast.version, DSL_VERSION)
  // 标题行 / 正文段 / think 块 / 结尾段——各自成段
  assert.equal(ast.segments.length, 4)
  assert.equal(ast.segments[0]?.type, 'prose')
  assert.equal(ast.segments[0]?.line, 1)
  assert.equal(ast.segments[1]?.type, 'prose')
  assert.equal(ast.segments[2]?.type, 'block')
  assert.equal(ast.segments[3]?.type, 'prose')
  // 锚：散文两条 + 块 body 内没有锚
  assert.equal(ast.anchors.length, 2)
  assert.deepEqual(
    ast.anchors.map((a) => [a.kind, a.ref, a.label, a.line]),
    [
      ['unit', 'su_a1', '原片演示', 3],
      ['stock', '600519', '贵州茅台', 3],
    ],
  )
})

test('容器块属性解析：裸值与带引号值（含空格）', () => {
  const ast = parseDsl([':::figure figureId=fig_ab12 caption="密集筹码 与 发散筹码" unitId=su_bb22', '占位', ':::'].join('\n'))
  const block = ast.segments[0]
  assert.equal(block?.type, 'block')
  if (block?.type !== 'block') return
  assert.equal(block.block.directive, 'figure')
  assert.equal(block.block.attrs.figureId, 'fig_ab12')
  assert.equal(block.block.attrs.caption, '密集筹码 与 发散筹码')
  assert.equal(block.block.attrs.unitId, 'su_bb22')
  assert.equal(block.block.body, '占位')
})

test('块断开散文：连续非空行合为一段，空行分段', () => {
  const ast = parseDsl(['第一段第一行', '第一段第二行', '', '第二段'].join('\n'))
  assert.equal(ast.segments.length, 2)
  assert.equal(ast.segments[0]?.type === 'prose' && ast.segments[0].text, '第一段第一行\n第一段第二行')
  assert.equal(ast.segments[1]?.type === 'prose' && ast.segments[1].text, '第二段')
})

test('未闭合容器块抛语法错并带行号', () => {
  assert.throws(
    () => parseDsl([':::think title=想一想', '没有闭合'].join('\n')),
    (err: unknown) => err instanceof DslSyntaxError && err.line === 1,
  )
})

test('collectUnitRefs：锚点与块属性去重保序（锚优先）', () => {
  const source = [
    '开头 [[unit:su_one|一]]，再看 [[unit:su_two|二]] 与 [[unit:su_one|一 again]]。',
    ':::sidenote title=趋势 unitId=su_three',
    '边注内容 [[unit:su_two|重复引用不算新]]',
    ':::',
    ':::clip assetId=med_x from=10 to=30 unitId=su_four caption="片段"',
    ':::',
  ].join('\n')
  const ast = parseDsl(source)
  assert.deepEqual(collectUnitRefs(ast), ['su_one', 'su_two', 'su_three', 'su_four'])
  assert.deepEqual(collectStockRefs(ast), [])
})

test('collectStockRefs：只收内联个股锚', () => {
  const source = '[[stock:600519|茅台]] 与 [[stock:000858|五粮]]。'
  assert.deepEqual(collectStockRefs(parseDsl(source)), ['600519', '000858'])
})
