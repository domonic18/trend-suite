import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDraftFailure } from './draftFailure'

/**
 * 起草失败归因（呈现层）：同一句「起草失败」下面可能是完全不同的事，
 * 教师该做什么也不同——配额用尽要去联系运营，改目录没用。
 */

test('归因：上游 429 配额用尽 → 提示联系运营，不让教师改目录', () => {
  const failure = classifyDraftFailure({
    errorCode: 'llm_upstream',
    errorMessage: '上游返回 429：已达到 Token Plan 用量上限',
  })
  assert.equal(failure.kind, 'quota')
  assert.equal(failure.action, null)
  assert.ok(failure.text.includes('配额'))
  assert.ok(failure.text.includes('运营'))
})

test('归因：上游 429 的其它措辞同样判配额', () => {
  assert.equal(
    classifyDraftFailure({ errorCode: 'llm_upstream', errorMessage: 'HTTP 429 rate limit' }).kind,
    'quota',
  )
})

test('归因：上游其它故障 → 稍后重试，不用改目标或目录', () => {
  const failure = classifyDraftFailure({
    errorCode: 'llm_upstream',
    errorMessage: 'socket hang up',
  })
  assert.equal(failure.kind, 'upstream')
  assert.equal(failure.action?.label, '重新提交')
})

test('归因：参数与内容类失败 → 让教师去改后重提', () => {
  for (const code of [
    'material_not_understood',
    'plan_input_missing',
    'outline_draft_empty',
    'llm_schema',
    'llm_bad_json',
    'llm_truncated',
    'plan_self_check_failed',
  ]) {
    const failure = classifyDraftFailure({ errorCode: code, errorMessage: null })
    assert.equal(failure.kind, 'input', code)
    assert.equal(failure.action?.label, '去修改重提', code)
  }
})

test('归因：认不出的失败给出原文，不编原因', () => {
  const failure = classifyDraftFailure({ errorCode: 'weird_code', errorMessage: '炸了' })
  assert.equal(failure.kind, 'unknown')
  assert.ok(failure.text.includes('炸了'))
})

test('归因：没有任务信息时也不报错，给一句兜底', () => {
  const failure = classifyDraftFailure(null)
  assert.equal(failure.kind, 'unknown')
  assert.ok(failure.text.length > 0)
})
