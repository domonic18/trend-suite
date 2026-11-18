import 'server-only'
import {
  marketDeclaration,
  type CaseStockEvent,
  type KlineBar,
  type MarketPeriod,
  type MarketStatus,
  type SectionQuotesView,
  type StockQuotesView,
} from '@trend-suite/contracts'
import type { FetchLike } from '@/server/content/agents/llm'
import { fetchQuotes, MarketSourceError } from './client'
import * as repo from './repo'
import type { CaseStockRow } from './repo'

/**
 * 案例股与行情（arch/06 §5）：步骤 1 复检落库、步骤 2 同步、步骤 3 读回、看板视图。
 * 源不可用 ≠ 失败：退避重试后仍败 → 该股记 unavailable、不写 bar、步骤照常完成
 * （发布可继续，看板显式占位，绝不编造数值）。
 */

// ---------------------------------------------------------------- 步骤 1：云端复检 + 落库

/** 日线数据源回溯下界（arch/06 §5.2）：更早窗口必须用周线。 */
const DAILY_EARLIEST = '2024-03-01'

/** 结构性违例：回灌重写（agent 没修好就挂起），与行情源不可用区分。 */
export class CaseStockRecheckError extends Error {
  readonly code = 'case_stock_invalid'
}

type RawStock = {
  code?: unknown
  name?: unknown
  exchange?: unknown
  period?: unknown
  windowStart?: unknown
  windowEnd?: unknown
  events?: unknown
}

export type RecheckedStock = {
  code: string
  name: string
  exchange: 'SH' | 'SZ'
  period: MarketPeriod
  windowStart: string
  windowEnd: string
  events: CaseStockEvent[]
  notes: string[]
}

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** 交易所由代码前缀定（60x/68x/9x→SH，00x/30x/20x→SZ），不信任模型自报。 */
function exchangeOf(code: string): 'SH' | 'SZ' | null {
  if (/^(60|68|9)/.test(code)) return 'SH'
  if (/^(00|30|20)/.test(code)) return 'SZ'
  return null
}

/** 云端复检（deterministic）：格式/窗口/事件落窗 + 自动归一（1d 深度不足→1w、交易所校正）。 */
export function recheckCaseStocks(product: unknown): RecheckedStock[] {
  const raw = (product as { stocks?: unknown } | null)?.stocks
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) {
    throw new CaseStockRecheckError('案例股清单须为 2–4 只股票')
  }
  return raw.map((entry): RecheckedStock => {
    const stock = entry as RawStock
    const code = typeof stock.code === 'string' ? stock.code : ''
    const name = typeof stock.name === 'string' ? stock.name.trim() : ''
    if (!/^\d{6}$/.test(code)) throw new CaseStockRecheckError(`股票代码不合法：${code || '（空）'}`)
    if (!name) throw new CaseStockRecheckError(`股票 ${code} 名称非空`)
    const exchange = exchangeOf(code)
    if (!exchange) throw new CaseStockRecheckError(`股票 ${code} 不是支持的 A 股代码段`)

    const notes: string[] = []
    let period: MarketPeriod = stock.period === '1w' ? '1w' : '1d'
    if (stock.period !== '1d' && stock.period !== '1w') {
      throw new CaseStockRecheckError(`股票 ${code} 周期只支持 1d/1w`)
    }
    if (!isIsoDate(stock.windowStart) || !isIsoDate(stock.windowEnd)) {
      throw new CaseStockRecheckError(`股票 ${code} 窗口日期不合法`)
    }
    // 收窄成局部常量：后面的 map 回调里 TS 不会保留属性收窄。
    const windowStart: string = stock.windowStart
    const windowEnd: string = stock.windowEnd
    if (windowStart > windowEnd) {
      throw new CaseStockRecheckError(`股票 ${code} 窗口起点晚于终点`)
    }
    if (period === '1d' && windowStart < DAILY_EARLIEST) {
      period = '1w'
      notes.push('日线深度不足，已自动改用周线')
    }
    const derived = exchangeOf(code)
    if (stock.exchange !== derived) notes.push('交易所按代码前缀校正')

    if (!Array.isArray(stock.events) || stock.events.length > 5) {
      throw new CaseStockRecheckError(`股票 ${code} 事件须为 ≤5 个`)
    }
    const events: CaseStockEvent[] = stock.events.map((e) => {
      const event = e as { date?: unknown; label?: unknown }
      const label = typeof event.label === 'string' ? event.label.trim() : ''
      if (!isIsoDate(event.date)) throw new CaseStockRecheckError(`股票 ${code} 事件日期不合法`)
      if (!label || label.length > 30) throw new CaseStockRecheckError(`股票 ${code} 事件说明须为 1–30 字`)
      if (event.date < windowStart || event.date > windowEnd) {
        throw new CaseStockRecheckError(`股票 ${code} 事件 ${event.date} 不在窗口内`)
      }
      return { date: event.date, label }
    })
    return {
      code,
      name,
      exchange: derived as 'SH' | 'SZ',
      period,
      windowStart,
      windowEnd,
      events,
      notes,
    }
  })
}

/** 步骤 1 收尾：复检通过 → 整节替换 section_case_stocks。抛 RecheckError 走回灌。 */
export async function persistCaseStocks(
  courseId: string,
  sectionId: string,
  product: unknown,
): Promise<void> {
  const stocks = recheckCaseStocks(product)
  await repo.replaceCaseStocks(courseId, sectionId, stocks)
}

// ---------------------------------------------------------------- 步骤 2：行情同步

export type SyncStockOutcome = {
  code: string
  period: MarketPeriod
  status: 'ok' | 'unavailable'
  bars: number
  reason?: string
}

export type SyncOutput = { syncedAt: string; perStock: SyncStockOutcome[] }

const BACKOFF_MS = [0, 1_000, 4_000]
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 逐股同步：退避重试（1s/4s）后仍败 → unavailable、不写 bar、不抛错。 */
export async function syncQuotesForSection(
  courseId: string,
  sectionId: string,
  options: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SyncOutput> {
  const doze = options.sleep ?? sleep
  const stocks = await repo.listCaseStocks(courseId, sectionId)
  const perStock: SyncStockOutcome[] = []
  for (const stock of stocks) {
    let lastReason = '行情源不可用'
    let bars: KlineBar[] | null = null
    for (const delay of BACKOFF_MS) {
      if (delay > 0) await doze(delay)
      try {
        bars = await fetchQuotes(
          { code: stock.code, exchange: stock.exchange },
          stock.period,
          stock.window_start,
          stock.window_end,
          { ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) },
        )
        break
      } catch (err) {
        if (err instanceof MarketSourceError) lastReason = err.message
        else throw err
      }
    }
    if (bars === null) {
      perStock.push({ code: stock.code, period: stock.period, status: 'unavailable', bars: 0, reason: lastReason })
      continue
    }
    await repo.upsertBars(stock.code, stock.period, bars)
    perStock.push({ code: stock.code, period: stock.period, status: 'ok', bars: bars.length })
  }
  return { syncedAt: new Date().toISOString(), perStock }
}

// ---------------------------------------------------------------- 步骤 3：读回核对

export type ReadbackStockOutcome = {
  code: string
  period: MarketPeriod
  marketStatus: MarketStatus
  barCount: number
  firstBar: string | null
  lastBar: string | null
  eventAnchors: { date: string; label: string; resolvedDate: string | null }[]
}

export type ReadbackOutput = { readbackAt: string; perStock: ReadbackStockOutcome[] }

/** 覆盖判定：首根落在窗口头容差内、末根落在尾容差内 → ok；有数但不齐 → partial。 */
export function marketStatusFor(
  bars: KlineBar[],
  windowStart: string,
  windowEnd: string,
  period: MarketPeriod,
): MarketStatus {
  if (bars.length === 0) return 'unavailable'
  const toleranceMs = (period === '1d' ? 6 : 13) * 86_400_000
  const startMs = Date.parse(windowStart)
  const endMs = Date.parse(windowEnd)
  const first = bars[0]
  const last = bars[bars.length - 1]
  if (!first || !last) return 'unavailable'
  const firstMs = Date.parse(first.d)
  const lastMs = Date.parse(last.d)
  const covered = firstMs <= startMs + toleranceMs && lastMs >= endMs - toleranceMs
  return covered ? 'ok' : 'partial'
}

/** 事件锚点归一：窗口内 ≤ 原值的最后交易日；窗口覆盖之前发生 → null。 */
export function resolveEventAnchor(
  events: CaseStockEvent[],
  bars: KlineBar[],
): ReadbackStockOutcome['eventAnchors'] {
  return events.map((event) => {
    const before = bars.filter((bar) => bar.d <= event.date)
    const resolved = before[before.length - 1]?.d ?? null
    return { date: event.date, label: event.label, resolvedDate: resolved }
  })
}

export async function readbackQuotes(courseId: string, sectionId: string): Promise<ReadbackOutput> {
  const stocks = await repo.listCaseStocks(courseId, sectionId)
  const perStock: ReadbackStockOutcome[] = []
  for (const stock of stocks) {
    const bars = await repo.barsFor(stock.code, stock.period, stock.window_start, stock.window_end)
    perStock.push({
      code: stock.code,
      period: stock.period,
      marketStatus: marketStatusFor(bars, stock.window_start, stock.window_end, stock.period),
      barCount: bars.length,
      firstBar: bars[0]?.d ?? null,
      lastBar: bars[bars.length - 1]?.d ?? null,
      eventAnchors: resolveEventAnchor(stock.events, bars),
    })
  }
  return { readbackAt: new Date().toISOString(), perStock }
}

// ---------------------------------------------------------------- 看板视图

/** 看板/学员端共用的单股行情视图：清单 + bars + 锚点归一（单一事实源）。 */
export async function sectionQuotes(courseId: string, sectionId: string): Promise<SectionQuotesView> {
  const stocks = await repo.listCaseStocks(courseId, sectionId)
  const views: StockQuotesView[] = await Promise.all(
    stocks.map(async (stock: CaseStockRow): Promise<StockQuotesView> => {
      const bars = await repo.barsFor(stock.code, stock.period, stock.window_start, stock.window_end)
      const lastSyncedAt =
        bars.length > 0
          ? new Date(Math.max(...bars.map((bar) => bar.synced_at.getTime()))).toISOString()
          : null
      return {
        id: stock.id,
        code: stock.code,
        name: stock.name,
        exchange: stock.exchange,
        period: stock.period,
        windowStart: stock.window_start,
        windowEnd: stock.window_end,
        events: stock.events,
        notes: stock.notes,
        marketStatus: marketStatusFor(bars, stock.window_start, stock.window_end, stock.period),
        bars: bars.map((bar) => ({ d: bar.d, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v })),
        eventAnchors: resolveEventAnchor(stock.events, bars),
        lastSyncedAt,
      }
    }),
  )
  return {
    sectionId,
    stocks: views,
    declaration: marketDeclaration,
  }
}
