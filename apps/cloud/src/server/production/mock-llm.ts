import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { FIXTURE_STOCKS } from '@/server/content/quotes/mock-quotes'

/**
 * 测试用 mock LLM（openai 协议）：模拟「模型调用 write_step_output 工具 → 返回最终答复」
 * 两轮最小会话。支持按节注入失败与每调用延迟（验收②③用），不打真实网络。
 * 第 1 步产物与 mock 行情源的 fixture 同源（同一份案例股清单）。
 * 步骤 4/6 产物里的 __MOCK_UNIT__ 按提示词里的 course_id 派生确定性 unit id
 * （同 id 多课种子会撞主键）——测试种子用 mockUnitIdFor(courseId) 插 source_units 行。
 */

/** 由 course_id 派生的确定性素材证据单元 id（su_ + 16 hex）。 */
export function mockUnitIdFor(courseId: string): string {
  return `su_${createHash('sha256').update(courseId).digest('hex').slice(0, 16)}`
}

export type MockLlm = {
  url: string
  calls: { path: string; body: Record<string, unknown> }[]
  /** 提示词包含该 sectionId 时上游返回 500（注入失败）。 */
  failSection: string | null
  /** 每次调用的人为延迟毫秒数（拉开崩溃窗口）。 */
  delayMs: number
  /** 覆盖第 1 步产物（复检归一/结构性失败用例注入）。 */
  step1Product: unknown | null
  /** 覆盖第 6 步产物（正文复检拒绝与回灌追平用例注入）。 */
  step6Product: unknown | null
  /** 覆盖第 5 步产物（回放课件复检拒绝用例注入）。 */
  step5Product: unknown | null
  /** 覆盖第 7 步产物（课件复检拒绝用例注入）。 */
  step7Product: unknown | null
  close(): Promise<void>
}

/** mock 步骤 4/6 产物里的素材证据单元占位：响应前按 course_id 替换为确定性 id。 */
const MOCK_UNIT_TOKEN = '__MOCK_UNIT__'

/** 步骤 6 mock 正文：五段骨架 + 证据锚 + 个股锚 + 术语边注，全部过 validator。 */
const MOCK_DRAFT_MARKDOWN = [
  `# 1. 趋势的定义`,
  ``,
  `趋势是价格运行的方向：高点与低点依次抬升为多头，依次下移为空头。这是本节最核心的概念，讲师在原片 [[unit:${MOCK_UNIT_TOKEN}|原片演示]] 中逐笔画出了这条主线。`,
  ``,
  `判断依据：先定级别再看方向。周线上只看大波段，日线上才谈入场时机；两个级别打架时，听大级别的。`,
  ``,
  `:::think title=想一想`,
  `如果价格横住不创新高也不创新低，趋势还算成立吗？带着这个问题看下一节的案例。`,
  `:::`,
  ``,
  `实例：[[stock:600519|贵州茅台]] 2023 年周线重心逐级上移，回调不破前低，是教科书式的多头趋势样本。`,
  ``,
  `:::sidenote title=趋势`,
  `价格的运行方向，由高低点序列刻画，而不是主观感受。`,
  `:::`,
  ``,
  `检查清单：周期是否一致；高低点是否依次抬升；量能是否配合；级别之间是否互相印证。`,
  ``,
  `常见误用：把日内波动当趋势反转，或在两个级别信号冲突时强行入场——级别混看是初学者最常踩的坑。`,
].join('\n')

/**
 * 步骤 5 mock 产物：逐根回放课件（迭代 7，arch/06 §2.2）。
 * 案例股与行情 fixture 同源（600519 周线 2023-01-01~2023-12-31，交易日见 mock-quotes），
 * 标注日与判断点日都取真实交易日，揭晓文案含概念词「趋势」——四条必带断言逐条成立。
 */
const MOCK_REPLAY_WIDGET = {
  type: 'bar-replay-decision',
  code: '600519',
  window: { from: '2023-01-01', to: '2023-12-31' },
  period: '1w',
  citations: [MOCK_UNIT_TOKEN],
  assertions: {},
  annotations: [
    {
      unitId: MOCK_UNIT_TOKEN,
      atMs: 30000,
      kind: 'structure',
      d: '2023-06-02',
      label: '周线级别抬升的高点',
    },
  ],
  decisions: [
    {
      atDate: '2023-05-05',
      question: '这一根周线之后，趋势是延续还是反转？',
      options: [{ label: '延续' }, { label: '反转' }],
      correct: '延续',
      revealText: '后市重心继续上移，趋势方向被验证。',
      unitId: MOCK_UNIT_TOKEN,
      atMs: 30000,
    },
  ],
}

/** 步骤 7 mock 产物：其余三类课件（术语全部落在概念表「趋势/级别」内）。 */
const MOCK_OTHER_WIDGETS = {
  widgets: [
    {
      type: 'mcq-quiz',
      citations: [MOCK_UNIT_TOKEN],
      assertions: {},
      question: '判断趋势延续的首要依据是什么？',
      options: [
        { id: 'a', label: '高点与低点依次抬升' },
        { id: 'b', label: '单根 K 线的涨跌' },
        { id: 'c', label: '分时成交的活跃度' },
      ],
      answerId: 'a',
      conceptRefs: ['趋势'],
    },
    {
      type: 'checklist',
      citations: [MOCK_UNIT_TOKEN],
      assertions: {},
      title: '趋势判断自检清单',
      items: [
        { text: '周期是否统一，同一级别内比较', conceptRef: '级别' },
        { text: '高点与低点是否依次抬升', conceptRef: '趋势' },
        { text: '两个级别的信号是否互相印证' },
      ],
    },
    {
      type: 'calc-trainer',
      citations: [MOCK_UNIT_TOKEN],
      assertions: {},
      formula: 'risk-reward',
      inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 },
      examples: [{ inputs: { entryPrice: 100, stopPrice: 90, targetPrice: 130 }, answer: 3 }],
    },
  ],
}

const STEP_PRODUCTS: Record<number, unknown> = {
  1: { stocks: FIXTURE_STOCKS },
  4: {
    figures: [
      { kind: 'keyframe', caption: '讲师手绘趋势线', unitId: MOCK_UNIT_TOKEN, secHint: 30 },
      {
        kind: 'diagram',
        caption: '密集与发散筹码对比',
        template: 'chip-contrast',
        params: {
          title: '筹码密集 vs 发散',
          leftLabel: '密集筹码',
          rightLabel: '发散筹码',
          leftCount: 12,
          rightCount: 8,
        },
      },
      { kind: 'generated', caption: '章节扉页装饰', prompt: '抽象蓝色几何装饰图，金融课程扉页氛围' },
    ],
  },
  5: { widgets: [MOCK_REPLAY_WIDGET] },
  6: { markdown: MOCK_DRAFT_MARKDOWN },
  7: MOCK_OTHER_WIDGETS,
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
  const state: { failSection: string | null; delayMs: number; step1Product: unknown | null; step6Product: unknown | null; step5Product: unknown | null; step7Product: unknown | null } = {
    failSection: null,
    delayMs: 0,
    step1Product: null,
    step6Product: null,
    step5Product: null,
    step7Product: null,
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

  /** 取步骤产物：__MOCK_UNIT__ 占位按提示词里的 course_id 派生确定性 unit id。 */
  function productFor(step: number, prompt: string): unknown {
    const override =
      step === 1
        ? state.step1Product
        : step === 5
          ? state.step5Product
          : step === 6
            ? state.step6Product
            : step === 7
              ? state.step7Product
              : null
    const base = override !== null ? override : (STEP_PRODUCTS[step] ?? {})
    const courseId = prompt.match(/course_id=([\w-]+)/)?.[1] ?? ''
    return JSON.parse(JSON.stringify(base).replaceAll(MOCK_UNIT_TOKEN, mockUnitIdFor(courseId)))
  }

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
    const product = productFor(step, prompt)
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
    get step6Product() {
      return state.step6Product
    },
    set step6Product(value: unknown | null) {
      state.step6Product = value
    },
    get step5Product() {
      return state.step5Product
    },
    set step5Product(value: unknown | null) {
      state.step5Product = value
    },
    get step7Product() {
      return state.step7Product
    },
    set step7Product(value: unknown | null) {
      state.step7Product = value
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
