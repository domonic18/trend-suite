import 'server-only'
import type { FetchLike } from '@/server/content/agents/llm'
import { getEnv } from '@/env'
import type { KlineBar, MarketPeriod } from '@trend-suite/contracts'

/**
 * 腾讯前复权 K 线客户端（arch/06 §5 口径权威）：
 * - 端点 GET /appstock/app/fqkline/get?param=<sym>,<day|week>,<start>,<end>,<count>,qfq
 * - 前复权 qfq；周期只取原生 day/week，不自聚合；
 * - 单页 ≤640 根；窗口受复检约束（1d 不早于 2024-03）时一页即覆盖；
 * - volume 单位手，amount 恒缺省不建模；
 * - 单源无备用：失败抛 retryable 的 MarketSourceError，由上层退避后降级占位。
 */

export const TENCENT_QUOTES_BASE_URL = 'https://web.ifzq.gtimg.cn'

const PAGE_SIZE = 640
const TIMEOUT_MS = 20_000

/** 行情源不可达/非 0 返回：retryable，上层退避重试后仍败则降级占位。 */
export class MarketSourceError extends Error {
  readonly code = 'market_source_unreachable'
  readonly retryable = true
}

export type SymbolCode = { code: string; exchange: 'SH' | 'SZ' }

export function tencentSymbol({ code, exchange }: SymbolCode): string {
  return `${exchange.toLowerCase()}${code}`
}

function periodParam(period: MarketPeriod): 'day' | 'week' {
  return period === '1d' ? 'day' : 'week'
}

function responseKey(period: MarketPeriod): string[] {
  return period === '1d' ? ['qfqday', 'day'] : ['qfqweek', 'week']
}

/** 腾讯 bar 原始顺序：[日期, 开盘, 收盘, 最高, 最低, 成交量(手), ...]。 */
function toBar(row: unknown[]): KlineBar | null {
  if (row.length < 6) return null
  const d = String(row[0])
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const nums = [1, 2, 3, 4, 5].map((k) => Number(row[k]))
  if (!nums.every((n) => Number.isFinite(n))) return null
  const [o, c, h, l, v] = nums as [number, number, number, number, number]
  return { d, o, h, l, c, v: Math.round(v) }
}

export type FetchQuotesOptions = {
  baseUrl?: string
  fetchImpl?: FetchLike
}

/** 拉一个股票一个周期的窗口 bars（升序、已过滤到窗口内）。 */
export async function fetchQuotes(
  symbol: SymbolCode,
  period: MarketPeriod,
  windowStart: string,
  windowEnd: string,
  options: FetchQuotesOptions = {},
): Promise<KlineBar[]> {
  const base = options.baseUrl ?? getEnv().MARKET_QUOTES_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const sym = tencentSymbol(symbol)
  const url = `${base}/appstock/app/fqkline/get?param=${sym},${periodParam(period)},${windowStart},${windowEnd},${PAGE_SIZE},qfq`
  let res: Response
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) } as RequestInit)
  } catch (err) {
    throw new MarketSourceError(`行情源请求失败：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    throw new MarketSourceError(`行情源 HTTP ${res.status}`)
  }
  let body: unknown
  try {
    body = JSON.parse(await res.text())
  } catch {
    throw new MarketSourceError('行情源返回非 JSON')
  }
  const payload = body as { code?: number; data?: Record<string, Record<string, unknown>> }
  if (payload.code !== 0 || !payload.data || !payload.data[sym]) {
    throw new MarketSourceError('行情源返回非 0 状态或缺股票数据')
  }
  const node = payload.data[sym]
  const raw = responseKey(period).map((key) => node[key]).find((v) => Array.isArray(v))
  if (!Array.isArray(raw)) {
    throw new MarketSourceError('行情源响应缺 K 线数组')
  }
  const bars = raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map(toBar)
    .filter((b): b is KlineBar => b !== null)
  return bars.filter((b) => b.d >= windowStart && b.d <= windowEnd).sort((a, b) => (a.d < b.d ? -1 : 1))
}
