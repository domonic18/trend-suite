import 'server-only'
import { query, queryOne } from '@/server/lib/db'

/**
 * 行情源条目（迁移 020）：运营台维护，至多一个默认源。
 * 运行时取默认源 base_url；查库失败由调用方回退环境变量。
 */

export type MarketQuoteSourceRow = {
  id: string
  name: string
  base_url: string
  enabled: boolean
  is_default: boolean
  note: string | null
  last_tested_at: Date | null
  last_test_result: string | null
  last_test_latency_ms: number | null
  last_test_error: string | null
  created_at: Date
  updated_at: Date
}

const COLUMNS = [
  'id',
  'name',
  'base_url',
  'enabled',
  'is_default',
  'note',
  'last_tested_at',
  'last_test_result',
  'last_test_latency_ms',
  'last_test_error',
  'created_at',
  'updated_at',
].join(', ')

export function listSources(): Promise<MarketQuoteSourceRow[]> {
  return query<MarketQuoteSourceRow>(
    `SELECT ${COLUMNS} FROM market_quote_sources ORDER BY is_default DESC, created_at`,
  )
}

export function findSourceById(id: string): Promise<MarketQuoteSourceRow | null> {
  return queryOne<MarketQuoteSourceRow>(
    `SELECT ${COLUMNS} FROM market_quote_sources WHERE id = $1`,
    [id],
  )
}

/** 运行时取默认源（启用中）：无则回 null，由调用方回退环境变量。 */
export function findDefaultQuotesSource(): Promise<MarketQuoteSourceRow | null> {
  return queryOne<MarketQuoteSourceRow>(
    `SELECT ${COLUMNS} FROM market_quote_sources WHERE is_default AND enabled`,
  )
}

export async function insertSource(input: {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  isDefault: boolean
  note: string | null
}): Promise<MarketQuoteSourceRow> {
  const row = await queryOne<MarketQuoteSourceRow>(
    `INSERT INTO market_quote_sources (id, name, base_url, enabled, is_default, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [input.id, input.name, input.baseUrl, input.enabled, input.isDefault, input.note],
  )
  if (!row) throw new Error('行情源条目写入失败')
  return row
}

export async function updateSource(
  id: string,
  input: {
    name?: string
    baseUrl?: string
    note?: string | null
    enabled?: boolean
    isDefault?: boolean
    lastTestedAt?: Date | null
    lastTestResult?: string | null
    lastTestLatencyMs?: number | null
    lastTestError?: string | null
  },
): Promise<MarketQuoteSourceRow> {
  const sets: string[] = []
  const values: unknown[] = []

  const put = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }

  if (input.name !== undefined) put('name', input.name)
  if (input.baseUrl !== undefined) put('base_url', input.baseUrl)
  if (input.note !== undefined) put('note', input.note)
  if (input.enabled !== undefined) put('enabled', input.enabled)
  if (input.isDefault !== undefined) put('is_default', input.isDefault)
  if (input.lastTestedAt !== undefined) put('last_tested_at', input.lastTestedAt)
  if (input.lastTestResult !== undefined) put('last_test_result', input.lastTestResult)
  if (input.lastTestLatencyMs !== undefined) put('last_test_latency_ms', input.lastTestLatencyMs)
  if (input.lastTestError !== undefined) put('last_test_error', input.lastTestError)

  if (sets.length === 0) {
    const existing = await findSourceById(id)
    if (!existing) throw new Error('行情源条目不存在')
    return existing
  }

  values.push(id)
  sets.push('updated_at = now()')
  const row = await queryOne<MarketQuoteSourceRow>(
    `UPDATE market_quote_sources SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
    values,
  )
  if (!row) throw new Error('行情源条目更新失败')
  return row
}

export function deleteSource(id: string): Promise<void> {
  return query('DELETE FROM market_quote_sources WHERE id = $1', [id]).then(() => undefined)
}

/** 设默认：清掉其他默认（部分唯一索引兜底，应用层先行清除）。 */
export async function clearDefaults(exceptId?: string): Promise<void> {
  await query(
    `UPDATE market_quote_sources SET is_default = false, updated_at = now()
     WHERE is_default AND ($1::text IS NULL OR id <> $1)`,
    [exceptId ?? null],
  )
}
