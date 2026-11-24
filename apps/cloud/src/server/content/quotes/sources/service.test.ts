import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { resolveQuotesBaseUrl } from '../client'
import {
  createMarketSource,
  deleteMarketSource,
  listMarketSources,
  updateMarketSource,
} from './service'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

test('行情源：迁移预置了一个默认源（腾讯 fqkline）', { skip }, async () => {
  const items = await listMarketSources()
  assert.equal(items.length, 1)
  assert.equal(items[0]!.isDefault, true)
  assert.equal(items[0]!.enabled, true)
  assert.match(items[0]!.id, /^mqs_[0-9a-f]{16}$/)
})

test('resolveQuotesBaseUrl：无显式 env 时取运营台默认源', { skip }, async () => {
  const explicit = process.env.MARKET_QUOTES_BASE_URL
  delete process.env.MARKET_QUOTES_BASE_URL
  try {
    const base = await resolveQuotesBaseUrl()
    const items = await listMarketSources()
    assert.equal(base, items[0]!.baseUrl)
  } finally {
    if (explicit !== undefined) process.env.MARKET_QUOTES_BASE_URL = explicit
  }
})

test('resolveQuotesBaseUrl：显式 env 优先于运营台（本地开发与测试口径）', { skip }, async () => {
  const previous = process.env.MARKET_QUOTES_BASE_URL
  process.env.MARKET_QUOTES_BASE_URL = 'https://explicit-env.example.com'
  try {
    assert.equal(await resolveQuotesBaseUrl(), 'https://explicit-env.example.com')
  } finally {
    if (previous === undefined) delete process.env.MARKET_QUOTES_BASE_URL
    else process.env.MARKET_QUOTES_BASE_URL = previous
  }
})

test('行情源 CRUD：base_url 去尾斜杠；设默认清旧默认；默认源不可删', { skip }, async () => {
  const created = await createMarketSource({
    name: '备用源',
    baseUrl: 'https://quotes.example.com/',
    isDefault: true,
  })
  assert.equal(created.baseUrl, 'https://quotes.example.com')
  assert.equal(created.isDefault, true)

  const afterCreate = await listMarketSources()
  assert.equal(afterCreate.filter((item) => item.isDefault).length, 1)
  assert.ok(afterCreate.find((item) => item.id === created.id)?.isDefault)

  const updated = await updateMarketSource(created.id, {
    name: '备用源（改）',
    enabled: false,
    note: '暂不启用',
  })
  assert.equal(updated.name, '备用源（改）')
  assert.equal(updated.enabled, false)
  assert.equal(updated.note, '暂不启用')

  const seeded = (await listMarketSources()).find((item) => item.id !== created.id)
  assert.ok(seeded)

  await assert.rejects(() => deleteMarketSource(created.id), /默认行情源不能删除/)
  await updateMarketSource(seeded.id, { isDefault: true })
  await deleteMarketSource(created.id)
  const remaining = await listMarketSources()
  assert.equal(remaining.find((item) => item.id === created.id), undefined)
  assert.equal(remaining.filter((item) => item.isDefault).length, 1)
})
