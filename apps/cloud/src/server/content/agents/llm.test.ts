import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { LlmError, runLlmJson } from './llm'

/**
 * LLM 通道用例：openai / anthropic 双协议报文、max_tokens 截断、ai_runs 记账。
 * fetch 注入 mock，不发真实请求。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

const schema = z.object({ title: z.string(), count: z.number() })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function seedModel(protocol: 'openai' | 'anthropic'): Promise<string> {
  const entry = await createModelEntry({
    name: `起草模型-${protocol}`,
    purposes: ['llm'],
    provider: 'Test',
    protocol,
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })
  return entry.id
}

test('openai 协议：解析 JSON 并把 tokens/时延记进 ai_runs', { skip }, async () => {
  await seedModel('openai')
  const calls: { url: string; body: string }[] = []
  const { data, runId } = await runLlmJson({
    task: 'content.curriculum',
    purpose: 'llm',
    refType: 'course',
    refId: 'crs_test',
    system: '系统提示：保密内容 SECRETSYSTEM',
    user: '用户提示：保密内容 SECRETUSER',
    maxTokens: 1024,
    schema,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: String(init.body) })
      return jsonResponse({
        choices: [{ message: { content: '{"title":"趋势","count":3}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 45 },
      })
    },
  })

  assert.equal(data.title, '趋势')
  assert.equal(data.count, 3)
  assert.equal(calls[0]?.url, 'https://llm.example.com/chat/completions')
  assert.ok(calls[0]?.body.includes('response_format'))

  const rows = await query<{
    status: string
    tokens_in: number | null
    tokens_out: number | null
    latency_ms: number | null
    summary: string | null
    source: string
  }>('SELECT status, tokens_in, tokens_out, latency_ms, summary, source FROM ai_runs WHERE id = $1', [
    runId,
  ])
  const row = rows[0]
  assert.equal(row?.status, 'succeeded')
  assert.equal(row?.tokens_in, 120)
  assert.equal(row?.tokens_out, 45)
  assert.ok((row?.latency_ms ?? 0) >= 0)
  assert.equal(row?.source, 'producer')
  // 不记 prompt 正文
  assert.ok(!(row?.summary ?? '').includes('SECRET'))

  const events = await query<{ kind: string; tokens_in: number | null }>(
    'SELECT kind, tokens_in FROM ai_usage_events WHERE run_id = $1',
    [runId],
  )
  assert.equal(events.length, 1)
  assert.equal(events[0]?.kind, 'tokens')
})

test('anthropic 协议：拼接 content 文本块，截断判可重试', { skip }, async () => {
  await seedModel('anthropic')
  const calls: string[] = []
  const ok = await runLlmJson({
    task: 'content.curriculum',
    purpose: 'llm',
    refType: 'course',
    refId: 'crs_test2',
    system: 's',
    user: 'u',
    maxTokens: 1024,
    schema,
    fetchImpl: async (url) => {
      calls.push(url)
      return jsonResponse({
        content: [
          { type: 'text', text: '{"title":"阻尼' },
          { type: 'text', text: '运动","count":5}' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 12 },
      })
    },
  })
  assert.equal(ok.data.title, '阻尼运动')
  assert.equal(calls[0], 'https://llm.example.com/v1/messages')

  await assert.rejects(
    () =>
      runLlmJson({
        task: 'content.curriculum',
        purpose: 'llm',
        refType: 'course',
        refId: 'crs_test3',
        system: 's',
        user: 'u',
        maxTokens: 64,
        schema,
        fetchImpl: async () =>
          jsonResponse({
            content: [{ type: 'text', text: '{"title":"截断"' }],
            stop_reason: 'max_tokens',
            usage: { input_tokens: 900, output_tokens: 64 },
          }),
      }),
    // 截断可重试：推理型模型每次思考长度不同，重试往往就过了。
    (err: unknown) =>
      err instanceof LlmError &&
      err.code === 'llm_truncated' &&
      err.retryable === true &&
      err.tokensOut === 64,
  )

  // 失败调用的用量也要入台账（截断那次的花费不能不算）。
  const failedRun = await query<{ status: string; tokens_out: number }>(
    `SELECT status, tokens_out FROM ai_runs WHERE ref_id = 'crs_test3'`,
  )
  assert.equal(failedRun[0]?.status, 'failed')
  assert.equal(failedRun[0]?.tokens_out, 64)
  const usage = await query<{ tokens_out: number }>(
    `SELECT tokens_out FROM ai_usage_events WHERE run_id IN (SELECT id FROM ai_runs WHERE ref_id = 'crs_test3')`,
  )
  assert.equal(usage[0]?.tokens_out, 64)
})

test('上游 5xx 与坏 JSON：可重试分类并留失败台账', { skip }, async () => {
  await seedModel('openai')
  await assert.rejects(
    () =>
      runLlmJson({
        task: 'content.curriculum',
        purpose: 'llm',
        refType: 'course',
        refId: 'crs_test4',
        system: 's',
        user: 'u',
        maxTokens: 128,
        schema,
        fetchImpl: async () => jsonResponse({ error: 'boom' }, 500),
      }),
    (err: unknown) => err instanceof LlmError && err.code === 'llm_upstream' && err.retryable === true,
  )

  await assert.rejects(
    () =>
      runLlmJson({
        task: 'content.curriculum',
        purpose: 'llm',
        refType: 'course',
        refId: 'crs_test5',
        system: 's',
        user: 'u',
        maxTokens: 128,
        schema,
        fetchImpl: async () =>
          jsonResponse({ choices: [{ message: { content: '这不是 JSON' } }] }),
      }),
    (err: unknown) => err instanceof LlmError && err.code === 'llm_bad_json' && err.retryable === true,
  )

  const failed = await query<{ status: string; summary: string | null }>(
    `SELECT status, summary FROM ai_runs WHERE ref_id = $1`,
    ['crs_test4'],
  )
  assert.equal(failed[0]?.status, 'failed')
  assert.ok((failed[0]?.summary ?? '').includes('llm_upstream'))
})
