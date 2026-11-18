import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { FIXTURE_STOCKS } from '@/server/content/quotes/mock-quotes'

/**
 * 测试用 mock LLM（openai 协议）：模拟「模型调用 write_step_output 工具 → 返回最终答复」
 * 两轮最小会话。支持按节注入失败与每调用延迟（验收②③用），不打真实网络。
 * 第 1 步产物与 mock 行情源的 fixture 同源（同一份案例股清单）。
 */

export type MockLlm = {
  url: string
  calls: { path: string; body: Record<string, unknown> }[]
  /** 提示词包含该 sectionId 时上游返回 500（注入失败）。 */
  failSection: string | null
  /** 每次调用的人为延迟毫秒数（拉开崩溃窗口）。 */
  delayMs: number
  /** 覆盖第 1 步产物（复检归一/结构性失败用例注入）。 */
  step1Product: unknown | null
  close(): Promise<void>
}

const STEP_PRODUCTS: Record<number, unknown> = {
  1: { stocks: FIXTURE_STOCKS },
  4: { figures: [{ title: '占位图一', kind: 'line' }] },
  5: { widgets: [{ kind: 'replay', title: '占位回放' }] },
  6: { paragraphs: ['占位正文段落。'] },
  7: { widgets: [{ kind: 'quiz', title: '占位课件' }] },
  8: { verdict: 'pass', notes: '占位评审通过' },
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

export async function startMockLlm(): Promise<MockLlm> {
  const state: { failSection: string | null; delayMs: number; step1Product: unknown | null } = {
    failSection: null,
    delayMs: 0,
    step1Product: null,
  }
  const calls: { path: string; body: Record<string, unknown> }[] = []

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      void handle(req, res, raw).catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'mock_internal' }))
      })
    })
  })

  async function handle(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}
    calls.push({ path: req.url ?? '', body })
    if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs))

    const messages = (body.messages ?? []) as { role?: string; content?: unknown }[]
    const last = messages[messages.length - 1]
    const lastRole = typeof last?.role === 'string' ? last.role : ''
    const prompt = textOf(last?.content)

    const reply = (payload: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    // 工具结果回传后 → 最终答复；否则 → 要求调用 write_step_output。
    if (lastRole === 'tool') {
      reply({
        choices: [{ message: { content: '第 N 步占位产物已写入。' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })
      return
    }

    if (state.failSection && prompt.includes(state.failSection)) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'injected failure' } }))
      return
    }

    const match = prompt.match(/第 (\d+) 步/)
    const step = match ? Number(match[1]) : 1
    const product = step === 1 && state.step1Product !== null ? state.step1Product : (STEP_PRODUCTS[step] ?? {})
    reply({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_mock_1',
                type: 'function',
                function: { name: 'write_step_output', arguments: JSON.stringify({ product }) },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    })
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    get failSection() {
      return state.failSection
    },
    set failSection(value: string | null) {
      state.failSection = value
    },
    get delayMs() {
      return state.delayMs
    },
    set delayMs(value: number) {
      state.delayMs = value
    },
    get step1Product() {
      return state.step1Product
    },
    set step1Product(value: unknown | null) {
      state.step1Product = value
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
