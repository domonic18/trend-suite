import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GET } from '../src/app/health/route.js'

test('GET /health 返回 ok', async () => {
  const res = await GET()
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.gitSha, 'dev')
})
