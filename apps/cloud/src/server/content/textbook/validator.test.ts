import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DslIssue } from '@trend-suite/contracts'
import { parseDsl } from './dsl-parser'
import { validateDsl, type ValidatorDeps } from './validator'

/**
 * DSL 第 2 层语义校验（arch/06 §2.4）：错误码全表至少一例。
 * figures 层的错误码（sec_not_grounded / *_quota_exceeded 图示侧等）
 * 在 production/figures.test.ts 覆盖。
 */

const DEPS: ValidatorDeps = {
  figureIds: new Set(['fig_ok1', 'fig_ok2']),
  units: new Map([['su_ok1', { assetId: 'med_a1', startMs: 10_000, endMs: 60_000 }]]),
  stockCodes: new Set(['600519']),
  terms: ['趋势', '级别', '筹码分布'],
}

const OK_DEPS = DEPS

function issuesOf(source: string, deps: ValidatorDeps = OK_DEPS): DslIssue[] {
  return validateDsl(parseDsl(source), deps)
}

function codeOf(issues: DslIssue[]): string[] {
  return issues.map((issue) => issue.code)
}

test('合规正文全过：五段骨架 + 锚点 + 块 + clip 落窗', () => {
  const source = [
    '# 1. 趋势的定义',
    '',
    '趋势是方向，讲师在 [[unit:su_ok1|原片演示]] 里逐笔画线，实例看 [[stock:600519|贵州茅台]]。',
    '',
    ':::sidenote title=趋势',
    '价格的运行方向，由高低点序列刻画。',
    ':::',
    '',
    ':::think title=想一想',
    '横住算不算趋势？',
    ':::',
    '',
    ':::clip assetId=med_a1 from=20 to=50 unitId=su_ok1 caption="逐笔画线片段"',
    ':::',
    '',
    ':::figure figureId=fig_ok1 caption="讲师手绘趋势线"',
    ':::',
  ].join('\n')
  assert.deepEqual(issuesOf(source), [])
})

test('figure_ref_unknown：:::figure 引用不在本节图示集', () => {
  const issues = issuesOf([':::figure figureId=fig_ghost caption="幽灵图"', ':::'].join('\n'))
  assert.ok(codeOf(issues).includes('figure_ref_unknown'))
  assert.equal(issues[0]?.line, 1)
})

test('unit_ref_unknown：块属性 unitId 不存在（board 必带 unitId）', () => {
  const issues = issuesOf([':::board unitId=su_ghost', '板书内容', ':::'].join('\n'))
  assert.ok(codeOf(issues).includes('unit_ref_unknown'))
})

test('unit_anchor_unknown：内联证据锚不存在（带行号）', () => {
  const issues = issuesOf('正文提到 [[unit:su_ghost|幽灵]] 这一段。')
  assert.ok(codeOf(issues).includes('unit_anchor_unknown'))
  assert.equal(issues.find((i) => i.code === 'unit_anchor_unknown')?.line, 1)
})

test('stock_not_in_list：个股锚不在本节案例股清单', () => {
  const issues = issuesOf('对照 [[stock:000001|平安银行]] 看走势。')
  assert.ok(codeOf(issues).includes('stock_not_in_list'))
})

test('term_not_in_concepts：术语边注不在概念表——带词、行号与最近似建议', () => {
  const issues = issuesOf([':::sidenote title=均线', '均价连线。', ':::'].join('\n'))
  const issue = issues.find((i) => i.code === 'term_not_in_concepts')
  assert.ok(issue)
  assert.equal(issue?.term, '均线')
  assert.equal(issue?.line, 1)
  assert.ok(issue?.suggestion, '应给出最近似的已收录术语建议')
})

test('术语全词匹配：别名原词可过、子串不可过', () => {
  // 全词命中（词表原词）
  assert.deepEqual(issuesOf([':::sidenote title=筹码分布', '成本分布。', ':::'].join('\n')), [])
  // 子串不是命中：「趋势」是词表词，但「趋势线」不在词表——不可放行
  const issues = issuesOf([':::sidenote title=趋势线', '画线工具。', ':::'].join('\n'))
  assert.ok(codeOf(issues).includes('term_not_in_concepts'))
})

test('clip_not_grounded：非整数窗 / 超 60s / 素材不一致 / 落窗外', () => {
  const badInt = issuesOf([':::clip assetId=med_a1 from=abc to=30 unitId=su_ok1 caption="片段"', ':::'].join('\n'))
  assert.ok(codeOf(badInt).includes('clip_not_grounded'))

  const tooLong = issuesOf([':::clip assetId=med_a1 from=0 to=61 unitId=su_ok1 caption="超长片段"', ':::'].join('\n'))
  assert.ok(codeOf(tooLong).includes('clip_not_grounded'))
  assert.ok(tooLong[0]?.message.includes('60s'))

  const wrongAsset = issuesOf([':::clip assetId=med_other from=10 to=30 unitId=su_ok1 caption="错素材片段"', ':::'].join('\n'))
  assert.ok(codeOf(wrongAsset).some((c) => c === 'clip_not_grounded' || c === 'unit_ref_unknown' || c === 'body_schema_failed'))

  const outOfWindow = issuesOf([':::clip assetId=med_a1 from=70 to=80 unitId=su_ok1 caption="窗外片段"', ':::'].join('\n'))
  assert.ok(codeOf(outOfWindow).includes('clip_not_grounded'))
  assert.ok(outOfWindow[0]?.message.includes('素材单元窗'))
})

test('directive_not_in_version：v2 块在 dslVersion=1 被版本门禁拒', () => {
  const issues = issuesOf([':::annotation unitId=su_ok1', '批注内容', ':::'].join('\n'))
  assert.ok(codeOf(issues).includes('directive_not_in_version'))
  assert.ok(issues[0]?.message.includes('v2'))
})

test('body_schema_failed：JSON 块形状与字段约束', () => {
  // 不是 JSON
  const notJson = issuesOf([':::cards', '这不是JSON', ':::'].join('\n'))
  assert.ok(codeOf(notJson).includes('body_schema_failed'))
  // timeline events 日期形状
  const badDate = issuesOf([':::timeline', JSON.stringify({ events: [{ date: '2024/3/5', title: 'x' }, { date: '2024-03-06', title: 'y' }, { date: '2024-03-07', title: 'z' }] }), ':::'].join('\n'))
  assert.ok(codeOf(badDate).includes('body_schema_failed'))
  // cards 超 4 张
  const tooMany = issuesOf([
    ':::cards',
    JSON.stringify({ items: [{ t: 'a', d: 'x' }, { t: 'b', d: 'x' }, { t: 'c', d: 'x' }, { t: 'd', d: 'x' }, { t: 'e', d: 'x' }] }),
    ':::',
  ].join('\n'))
  assert.ok(codeOf(tooMany).includes('body_schema_failed'))
  // sidenote 缺 title
  const noTitle = issuesOf([':::sidenote', '边注内容。', ':::'].join('\n'))
  assert.ok(codeOf(noTitle).includes('body_schema_failed'))
  // think title 超长
  const longTitle = issuesOf([`:::think title=${'超'.repeat(51)}`, '内容', ':::'].join('\n'))
  assert.ok(codeOf(longTitle).includes('body_schema_failed'))
  // warn variant 不在四型
  const badVariant = issuesOf([':::warn title=注意 variant=panic', '内容', ':::'].join('\n'))
  assert.ok(codeOf(badVariant).includes('body_schema_failed'))
})

test('配额：think≤3 / sidenote≤8 / cards≤2 / clip≤3 / figure≤8（首个越界块报错带行号）', () => {
  const think = Array.from({ length: 4 }, (_, i) => [`:::think title=问题${i}`, '内容', ':::', ''].flat()).flat()
  const thinkIssues = issuesOf(think.join('\n'))
  assert.ok(codeOf(thinkIssues).includes('think_quota_exceeded'))
  assert.equal(thinkIssues.find((i) => i.code === 'think_quota_exceeded')?.line, 13)

  const sidenotes = Array.from({ length: 9 }, (_, i) => [`:::sidenote title=${i % 2 === 0 ? '趋势' : '级别'}`, '注', ':::', ''].flat()).flat()
  assert.ok(codeOf(issuesOf(sidenotes.join('\n'))).includes('sidenote_quota_exceeded'))

  const cards = Array.from({ length: 3 }, () => [':::cards', JSON.stringify({ items: [{ t: 'a', d: 'x' }] }), ':::', ''].flat()).flat()
  assert.ok(codeOf(issuesOf(cards.join('\n'))).includes('cards_quota_exceeded'))

  const clips = Array.from({ length: 4 }, (_, i) => [`:::clip assetId=med_a1 from=${i * 10} to=${i * 10 + 5} unitId=su_ok1 caption="片段${i}"`, ':::', ''].flat()).flat()
  assert.ok(codeOf(issuesOf(clips.join('\n'))).includes('clip_quota_exceeded'))

  const figures = Array.from({ length: 9 }, (_, i) => [`:::figure figureId=fig_ok1 caption="图${i}"`, ':::', ''].flat()).flat()
  assert.ok(codeOf(issuesOf(figures.join('\n'))).includes('figure_quota_exceeded'))
})
