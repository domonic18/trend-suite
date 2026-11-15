import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, forgive, hit } from './rate-limit'

test('连续失败超过上限后被拒，且给出剩余等待秒数', () => {
  const key = 'unit-rate-limit-over'
  for (let i = 0; i < 3; i += 1) {
    assert.equal(hit(key, 3, 60_000).allowed, true)
  }
  assert.equal(check(key, 3, 60_000).allowed, false)
  assert.ok(check(key, 3, 60_000).retryAfterS > 0)
})

test('成功登录后计数被撤销', () => {
  const key = 'unit-rate-limit-forgive'
  hit(key, 1, 60_000)
  assert.equal(check(key, 1, 60_000).allowed, false)
  forgive(key)
  assert.equal(check(key, 1, 60_000).allowed, true)
})

test('窗口过期后重新放行', async () => {
  const key = 'unit-rate-limit-window'
  hit(key, 1, 20)
  await sleep(40)
  const after = check(key, 1, 20)
  assert.equal(after.allowed, true)
})
