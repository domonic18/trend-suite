import { test } from 'node:test'
import assert from 'node:assert/strict'
import { healthResponse } from '../src/index.js'

test('healthResponse 契约', () => {
  assert.equal(healthResponse.parse({ ok: true }).ok, true)
})
