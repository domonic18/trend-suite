import 'server-only'
import type { PoolClient } from 'pg'
import { query, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import type { CaseStockEvent, KlineBar, MarketPeriod } from '@trend-suite/contracts'

/**
 * 案例股清单与行情缓存的数据访问（arch/03 §2.3）：
 * - section_case_stocks (course_id, section_id, code, period) 唯一 = 复检落库幂等锚点；
 * - quote_bars (code, period, trade_date) 唯一 = 幂等 upsert，数值以源为准覆盖。
 */

export type CaseStockRow = {
  id: string
  course_id: string
  section_id: string
  code: string
  name: string
  exchange: 'SH' | 'SZ'
  period: MarketPeriod
  window_start: string
  window_end: string
  events: CaseStockEvent[]
  notes: string[]
  updated_at: Date
}

export type QuoteBarRow = KlineBar & { synced_at: Date }

const STOCK_COLUMNS =
  'id, course_id, section_id, code, name, exchange, period, window_start::text, window_end::text, events, notes, updated_at'

/** 复检通过后整节替换清单（事务内 delete + insert，落库即成套）。 */
export async function replaceCaseStocks(
  courseId: string,
  sectionId: string,
  stocks: {
    code: string
    name: string
    exchange: 'SH' | 'SZ'
    period: MarketPeriod
    windowStart: string
    windowEnd: string
    events: CaseStockEvent[]
    notes: string[]
  }[],
): Promise<void> {
  await withTransaction(async (tx: PoolClient) => {
    await tx.query(`DELETE FROM section_case_stocks WHERE course_id = $1 AND section_id = $2`, [
      courseId,
      sectionId,
    ])
    for (const stock of stocks) {
      await tx.query(
        `INSERT INTO section_case_stocks
           (id, course_id, section_id, code, name, exchange, period, window_start, window_end, events, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
        [
          newId('caseStock'),
          courseId,
          sectionId,
          stock.code,
          stock.name,
          stock.exchange,
          stock.period,
          stock.windowStart,
          stock.windowEnd,
          JSON.stringify(stock.events),
          JSON.stringify(stock.notes),
        ],
      )
    }
  })
}

export function listCaseStocks(courseId: string, sectionId: string): Promise<CaseStockRow[]> {
  return query<CaseStockRow>(
    `SELECT ${STOCK_COLUMNS} FROM section_case_stocks
     WHERE course_id = $1 AND section_id = $2 ORDER BY code ASC`,
    [courseId, sectionId],
  )
}

/** 读回一个股票一个周期窗口内的 bars（升序）。 */
export function barsFor(
  code: string,
  period: MarketPeriod,
  windowStart: string,
  windowEnd: string,
): Promise<QuoteBarRow[]> {
  return query<QuoteBarRow>(
    `SELECT trade_date::text AS d, open::float8 AS o, high::float8 AS h,
            low::float8 AS l, close::float8 AS c, volume::float8 AS v, synced_at
     FROM quote_bars
     WHERE code = $1 AND period = $2 AND trade_date BETWEEN $3::date AND $4::date
     ORDER BY trade_date ASC`,
    [code, period, windowStart, windowEnd],
  )
}

/** 某只股票在日期区间内的真实交易日（升序、去重跨周期）。 */
export async function tradingDays(code: string, from: string, to: string): Promise<string[]> {
  const rows = await query<{ d: string }>(
    `SELECT DISTINCT trade_date::text AS d FROM quote_bars
     WHERE code = $1 AND trade_date BETWEEN $2::date AND $3::date
     ORDER BY d ASC`,
    [code, from, to],
  )
  return rows.map((row) => row.d)
}

/** 批量 upsert bars（数值可核：同键以源为准覆盖）。chunk 分批防参数溢出。 */
export async function upsertBars(
  code: string,
  period: MarketPeriod,
  bars: KlineBar[],
): Promise<void> {
  const CHUNK = 250
  for (let i = 0; i < bars.length; i += CHUNK) {
    const chunk = bars.slice(i, i + CHUNK)
    const values: unknown[] = []
    const tuples = chunk.map((bar) => {
      const base = values.length
      values.push(code, period, bar.d, bar.o, bar.h, bar.l, bar.c, bar.v)
      return `($${base + 1}, $${base + 2}, $${base + 3}::date, $${base + 4}::numeric, $${base + 5}::numeric, $${base + 6}::numeric, $${base + 7}::numeric, $${base + 8}::bigint, now())`
    })
    await query(
      `INSERT INTO quote_bars (code, period, trade_date, open, high, low, close, volume, synced_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (code, period, trade_date)
       DO UPDATE SET open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
                     close = EXCLUDED.close, volume = EXCLUDED.volume, synced_at = now()`,
      values,
    )
  }
}
