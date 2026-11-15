import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { createAccount, endSession, resolveSession, startSession } from './service'

const url = testDatabaseUrl()
// 测试库接管连接串：db 池在首次查询时才读 env，这里赋值仍然来得及
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

before(async () => {
  if (url) await resetTestDatabase()
})

test('建号后可用口令登录，会话可解析、可撤销', { skip }, async () => {
  const account = await createAccount({
    username: 'laoshi',
    password: 'correct-horse',
    role: 'producer',
  })
  assert.equal(account.role, 'producer')
  assert.equal(account.status, 'active')

  const session = await startSession('laoshi', 'correct-horse')
  assert.ok(session)

  const user = await resolveSession(session.token)
  assert.equal(user?.username, 'laoshi')
  assert.equal(user?.role, 'producer')

  await endSession(session.token)
  assert.equal(await resolveSession(session.token), null)
})

test('错误口令与不存在的账号都登录失败', { skip }, async () => {
  assert.equal(await startSession('laoshi', 'wrong-password'), null)
  assert.equal(await startSession('nobody', 'correct-horse'), null)
})

test('同名账号被拒，不产生第二行', { skip }, async () => {
  await assert.rejects(
    () => createAccount({ username: 'laoshi', password: 'another-password', role: 'producer' }),
    /用户名已被占用/,
  )
})

test('会话令牌只存哈希，库里没有明文', { skip }, async () => {
  const session = await startSession('laoshi', 'correct-horse')
  assert.ok(session)
  const { query } = await import('@/server/lib/db')
  const rows = await query<{ token_hash: string }>('SELECT token_hash FROM sessions')
  assert.ok(rows.length > 0)
  assert.equal(
    rows.some((r) => r.token_hash === session.token),
    false,
  )
})
