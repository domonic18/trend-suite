import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query, queryOne } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'

/**
 * 通道单测（SP4 落产面）：主失败 → 冷却 → 备顶上（两条 ai_run）；
 * 预算触线 → 调用前硬停。AI_TOKEN_BUDGET_DAILY 在模块加载前注入，
 * channel.ts 的模块级常量在 import 时读取——本文件用动态 import。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'
process.env.AI_TOKEN_BUDGET_DAILY = '500'

const { TrendChatModel, resolveTaskCandidates, assertProducerBudget } = await import('./channel')
const { createModelEntry, updateTaskBinding } = await import('@/server/models/service')
const { AIMessage, HumanMessage, SystemMessage } = await import('@langchain/core/messages')

const TASK = 'content.case_stocks'

type TestServer = {
  url: string
  hitCount: () => number
  close: () => Promise<void>
}

function startServer(handler: (body: Record<string, unknown>, res: ServerResponse) => void): Promise<TestServer> {
  let hits = 0
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      hits += 1
      handler(raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {}, res)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        hitCount: () => hits,
        close: () =>
          new Promise((resolveClose, rejectClose) => {
            server.closeAllConnections()
            server.close((err) => (err ? rejectClose(err) : resolveClose()))
          }),
      })
    })
  })
}

async function okServer(text: string): Promise<TestServer> {
  return startServer((_body, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        choices: [{ message: { content: text } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    )
  })
}

async function deadServer(): Promise<TestServer> {
  return startServer((_body, res) => {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'boom' } }))
  })
}

before(async () => {
  if (url) await resetTestDatabase()
})

after(async () => {
  // 进程退出前释放（budget 用例之后无其他用例）
})

test('主备切换：主失败冷却、备顶上，两条 ai_run 一败一成', { skip }, async () => {
  const bad = await deadServer()
  const good = await okServer('备模型答复')
  const primary = await createModelEntry({
    name: '主模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'primary-model',
    baseUrl: bad.url,
    apiKey: 'sk-primary',
  })
  const backup = await createModelEntry({
    name: '备模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'backup-model',
    baseUrl: good.url,
    apiKey: 'sk-backup',
  })
  await updateTaskBinding({ task: TASK, primaryModelId: primary.id, backupModelId: backup.id })

  // 候选顺序 = 主 → 备
  const candidates = await resolveTaskCandidates(TASK, 'llm')
  assert.deepEqual(candidates.map((c) => c.modelId), [primary.id, backup.id])

  const model = new TrendChatModel({ task: TASK, purpose: 'llm', refType: 'unit_test', refId: 'failover' })
  const message = await model.invoke([new SystemMessage('系统'), new HumanMessage('你好')])
  assert.ok(message instanceof AIMessage)
  assert.equal(message.content, '备模型答复')
  assert.equal(good.hitCount(), 1)
  assert.equal(bad.hitCount(), 1)

  const runs = await query<{ status: string; model_id: string }>(
    `SELECT status, model_id FROM ai_runs WHERE ref_id = 'failover' ORDER BY created_at`,
  )
  assert.deepEqual(runs, [
    { status: 'failed', model_id: primary.id },
    { status: 'succeeded', model_id: backup.id },
  ])
  const usage = await query<{ run_id: string }>(
    `SELECT e.run_id FROM ai_usage_events e JOIN ai_runs r ON r.id = e.run_id WHERE r.ref_id = 'failover'`,
  )
  assert.equal(usage.length, 1, '只有成功的调用记用量')

  // 主模型进入冷却：再次解析只剩备
  const cooledRow = await queryOne<{ cooldown_until: Date | null }>(
    `SELECT cooldown_until FROM ai_models WHERE id = $1`,
    [primary.id],
  )
  assert.ok(cooledRow?.cooldown_until, '主模型被置冷却')
  const cooled = await resolveTaskCandidates(TASK, 'llm')
  assert.deepEqual(cooled.map((c) => c.modelId), [backup.id])

  await bad.close()
  await good.close()
})

test('预算硬停：触线后调用前拦截，不出无账本请求', { skip }, async () => {
  // 造一笔超额用量（预算 500）：真实 model 行（ai_runs 外键）+ ai_runs + ai_usage_events
  const probeModel = await createModelEntry({
    name: '预算探针模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'budget-probe',
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'sk-probe',
  })
  const runId = newId('aiRun')
  await query(
    `INSERT INTO ai_runs (id, source, task_key, ref_type, ref_id, model_id, model, provider, status)
     VALUES ($1, 'producer', 'content.case_stocks', 'budget_probe', 'probe', $2, 'budget-probe', 'Test', 'succeeded')`,
    [runId, probeModel.id],
  )
  await query(`UPDATE ai_runs SET tokens_in = 400, tokens_out = 200 WHERE id = $1`, [runId])
  await query(`INSERT INTO ai_usage_events (id, run_id, kind, tokens_in, tokens_out) VALUES ($1, $2, 'tokens', 400, 200)`, [
    newId('aiUsage'),
    runId,
  ])

  await assert.rejects(
    () => assertProducerBudget(),
    (err: unknown) => err instanceof Error && err.message.includes('预算'),
  )

  // 走完整 _generate：同样在候选链之前被预算拦截
  const model = new TrendChatModel({ task: TASK, purpose: 'llm', refType: 'unit_test', refId: 'budget_block' })
  await assert.rejects(
    () => model.invoke([new HumanMessage('你好')]),
    (err: unknown) => err instanceof Error && err.message.includes('预算'),
  )
  const runs = await query<{ id: string }>(`SELECT id FROM ai_runs WHERE ref_id = 'budget_block'`)
  assert.equal(runs.length, 0, '预算拦截发生在记账之前——没有 ai_run 落库')
})
