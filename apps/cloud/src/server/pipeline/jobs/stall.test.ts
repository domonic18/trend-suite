import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_STALL_TIMEOUT_MS, isStalled } from './stall'

test('停滞判定：阈值内不算停滞，到点即算停滞', () => {
  const now = 1_000_000
  assert.equal(isStalled({ lastAliveAt: now - 1_000, now, timeoutMs: DEFAULT_STALL_TIMEOUT_MS }), false)
  assert.equal(
    isStalled({ lastAliveAt: now - DEFAULT_STALL_TIMEOUT_MS, now, timeoutMs: DEFAULT_STALL_TIMEOUT_MS }),
    true,
  )
  assert.equal(
    isStalled({ lastAliveAt: now - DEFAULT_STALL_TIMEOUT_MS - 1, now, timeoutMs: DEFAULT_STALL_TIMEOUT_MS }),
    true,
  )
})

test('停滞判定：阈值可注入（测试用小阈值）', () => {
  assert.equal(isStalled({ lastAliveAt: 0, now: 999, timeoutMs: 1_000 }), false)
  assert.equal(isStalled({ lastAliveAt: 0, now: 2_000, timeoutMs: 1_000 }), true)
})
