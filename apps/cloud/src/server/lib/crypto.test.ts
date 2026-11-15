import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, generateToken, hashToken } from './crypto'

test('口令哈希可校验，错误口令不通过', async () => {
  const stored = await hashPassword('correct-horse')
  assert.equal(stored.startsWith('scrypt$'), true)
  assert.equal(stored.includes('correct-horse'), false)
  assert.equal(await verifyPassword('correct-horse', stored), true)
  assert.equal(await verifyPassword('wrong-horse', stored), false)
})

test('同一口令两次哈希不同（盐随机），都能校验通过', async () => {
  const a = await hashPassword('same-password')
  const b = await hashPassword('same-password')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('same-password', a), true)
  assert.equal(await verifyPassword('same-password', b), true)
})

test('哈希串被篡改时一律判否，不抛错', async () => {
  assert.equal(await verifyPassword('x', 'not-a-hash'), false)
  assert.equal(await verifyPassword('x', 'scrypt$1$2$3'), false)
})

test('令牌哈希是单向的，库里的哈希推不出令牌', () => {
  const token = generateToken()
  const hash = hashToken(token)
  assert.equal(hash.length, 64)
  assert.equal(hashToken(token), hash)
  assert.notEqual(hash, token)
})
