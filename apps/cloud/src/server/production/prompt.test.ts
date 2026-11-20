import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionPrompt } from './agent'
import type { SectionRow } from './repo'
import { stepDef } from './steps'

/**
 * 提示词与契约的对齐（arch/05 §8 / arch/06 §2）：
 *
 * 端到端实测暴露两类「模型做不到」——
 * 1. 正文步的 `:::think` / `:::warn` **必带 title**、JSON 块的 body 形状，
 *    这些约束只在校验器里，提示词没写 → 模型写不出来，三次回灌后转人工。
 * 2. 图示 params 的形状只写在提示词散文里，草稿 schema 是自由键值对 → 模型看不见。
 *    （第 2 条由 figure-draft.test.ts 守着：形状进了工具 schema。）
 *
 * 本文件守第 1 条：**校验器收口的约束，提示词必须写出来**。
 */

const SECTION: SectionRow = {
  id: 'sec_test',
  course_id: 'crs_test',
  section_id: '1-1',
  title: '趋势的定义',
  sort_order: 0,
  status: 'pending',
  placeholder: {},
  body_status: 'none',
  created_at: new Date(),
  updated_at: new Date(),
}

test('正文步提示词写明容器块的必填属性与 JSON 块形状', () => {
  const prompt = sectionPrompt(stepDef(6), SECTION)
  assert.ok(prompt.includes(':::think 与 :::warn 必带 title'), 'think/warn 的 title 要求')
  assert.ok(prompt.includes('variant'), 'warn 的 variant 要求')
  assert.ok(prompt.includes(':::board 必带 unitId'), 'board 的 unitId 要求')
  assert.ok(prompt.includes('{"items":[{"num":"1"'), 'cards 的 body 形状')
  assert.ok(prompt.includes('{"events":[{"date":"YYYY-MM-DD"'), 'timeline 的 body 形状')
  assert.ok(prompt.includes('一行 JSON'), 'JSON 块 body 必须一行')
})

test('正文步提示词写明 :::sidenote 的术语来源与正文长度上限', () => {
  const prompt = sectionPrompt(stepDef(6), SECTION)
  assert.ok(prompt.includes('list_concepts'), '术语只能取概念表')
  assert.ok(prompt.includes('1~500 字'), '容器块正文长度上限')
})

test('图示步提示词不再复述模板参数（形状由工具 schema 给，避免两处漂移）', () => {
  const prompt = sectionPrompt(stepDef(4), SECTION)
  assert.ok(prompt.includes('工具 schema'), '指向工具 schema')
  assert.ok(!prompt.includes('leftCount 4-24'), '参数取值域不再抄进散文')
  assert.ok(!prompt.includes('rows[{y 0-100'), '参数形状不再抄进散文')
})
