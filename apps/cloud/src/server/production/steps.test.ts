import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_MAX_TOKENS } from './channel'
import { STEP_DEFS, stepMaxTokens, stepTimeoutMs } from './steps'

/**
 * 九步的输出预算（arch/05 §6）：推理型模型的思考与正文共用 max_tokens，
 * 通道的 4K 默认会被思考吃光 → llm_truncated（真环境第一次跑九步就卡在第 1 步）。
 */

test('每个 agent 步都有高于通道默认的输出预算', () => {
  for (const def of STEP_DEFS) {
    if (def.kind !== 'agent') continue
    assert.ok(
      stepMaxTokens(def.key) > DEFAULT_MAX_TOKENS,
      `${def.key} 的预算 ${stepMaxTokens(def.key)} 应高于通道默认 ${DEFAULT_MAX_TOKENS}`,
    )
  }
})

test('产物越大的步预算越高：正文与课件 > 案例股', () => {
  assert.ok(stepMaxTokens('section_draft') >= 16_000)
  assert.ok(stepMaxTokens('widgets') >= 16_000)
  assert.ok(stepMaxTokens('replay_widget') >= 16_000)
  assert.ok(stepMaxTokens('case_stocks') >= 12_000)
})

test('未登记的步用通道默认预算', () => {
  assert.equal(stepMaxTokens('market_sync'), DEFAULT_MAX_TOKENS)
})

test('产物越大的步超时越宽：正文一步远跑不完通道默认的 120s', () => {
  assert.ok(
    stepTimeoutMs('section_draft') > DEFAULT_CALL_TIMEOUT_MS,
    '正文步（1200~3000 字 + 多次证据往返）不得落在通道默认超时内',
  )
  assert.ok(stepTimeoutMs('widgets') >= 240_000)
  assert.equal(stepTimeoutMs('market_sync'), DEFAULT_CALL_TIMEOUT_MS)
})
