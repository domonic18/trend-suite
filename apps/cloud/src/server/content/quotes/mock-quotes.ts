import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { KlineBar } from '@trend-suite/contracts'

/**
 * 测试用 mock 行情源（腾讯 fqkline 形态）：GET /appstock/app/fqkline/get?param=...
 * 返回 data.<sym>.qfqday|qfqweek 的 [日期,开,收,高,低,量] 数组；可整体/按股注入失败。
 * 案例股 fixture 与 mock-llm 的第 1 步产物共用（同一份清单）。
 */

/** 步骤 1 产物（agent mock 写出的真实形状清单，arch/06 §5.1）。 */
export const FIXTURE_STOCKS = [
  {
    code: '600519',
    name: '贵州茅台',
    exchange: 'SH',
    period: '1w',
    windowStart: '2023-01-01',
    windowEnd: '2023-12-31',
    events: [{ date: '2023-10-28', label: '三季报披露窗口' }],
  },
  {
    code: '000001',
    name: '平安银行',
    exchange: 'SZ',
    period: '1d',
    windowStart: '2024-03-04',
    windowEnd: '2024-03-15',
    events: [],
  },
] as const

function barsOf(symbol: string): KlineBar[] {
  if (symbol === 'sh600519') {
    const dates = [
      '2023-01-06', '2023-02-03', '2023-03-03', '2023-04-07', '2023-05-05', '2023-06-02',
      '2023-07-07', '2023-08-04', '2023-09-01', '2023-10-06', '2023-10-27', '2023-11-24', '2023-12-29',
    ]
    return dates.map((d, i) => ({ d, o: 1700 + i, h: 1725 + i, l: 1688 + i, c: 1710 + i, v: 10000 + i * 37 }))
  }
  if (symbol === 'sz000001') {
    const dates = [
      '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08',
      '2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15',
    ]
    return dates.map((d, i) => ({ d, o: 1050 + i * 2, h: 1064 + i * 2, l: 1045 + i * 2, c: 1058 + i * 2, v: 32000 + i * 97 }))
  }
  if (symbol === 'sh600036') {
    const dates = [
      '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08',
      '2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15',
    ]
    return dates.map((d, i) => ({ d, o: 3000 + i, h: 3015 + i, l: 2990 + i, c: 3008 + i, v: 22000 + i * 53 }))
  }
  if (symbol === 'sh601318') {
    const dates = [
      '2023-01-06', '2023-02-03', '2023-03-03', '2023-04-07', '2023-05-05', '2023-06-02',
      '2023-07-07', '2023-08-04', '2023-09-01', '2023-10-06', '2023-10-27', '2023-11-24', '2023-12-29',
    ]
    return dates.map((d, i) => ({ d, o: 500 + i, h: 512 + i, l: 495 + i, c: 506 + i, v: 8000 + i * 21 }))
  }
  return []
}

export type MockQuotes = {
  url: string
  requests: string[]
  /** true 时全部返回 500（验收②：源挂掉）。 */
  failAll: boolean
  /** 追加要失败的 symbol（如 sh600519），测单股降级。 */
  failSymbols: string[]
  close(): Promise<void>
}

export async function startMockQuotes(): Promise<MockQuotes> {
  const state: { failAll: boolean; failSymbols: string[] } = { failAll: false, failSymbols: [] }
  const requests: string[] = []

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch(() => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'mock_internal' }))
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    requests.push(url.pathname + url.search)
    if (state.failAll) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'injected source outage' }))
      return
    }
    const param = url.searchParams.get('param') ?? ''
    const [sym, period, start, end] = param.split(',')
    if (!sym || !period || !start || !end) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'bad param' }))
      return
    }
    if (state.failSymbols.includes(sym)) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'injected symbol outage' }))
      return
    }
    // 腾讯列序：[日期, 开盘, 收盘, 最高, 最低, 成交量(手)]
    const rows = barsOf(sym)
      .filter((bar) => bar.d >= start && bar.d <= end)
      .map((bar) => [bar.d, String(bar.o), String(bar.c), String(bar.h), String(bar.l), String(bar.v)])
    const key = period === 'week' ? 'qfqweek' : 'qfqday'
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ code: 0, data: { [sym]: { [key]: rows, qt: {} } } }))
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    get failAll() {
      return state.failAll
    },
    set failAll(value: boolean) {
      state.failAll = value
    },
    get failSymbols() {
      return state.failSymbols
    },
    set failSymbols(value: string[]) {
      state.failSymbols = value
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
