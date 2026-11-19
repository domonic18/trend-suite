import 'server-only'
import { z } from 'zod'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { openSecret } from '@/server/lib/crypto'
import { findBinding, findDefaultModel, findModelById, type ModelRow } from '@/server/models/repo'
import { normalizeBaseUrl } from '@/server/models/service'

/**
 * 课程生产 LLM 通道（arch/07 §9/§10）：按任务键解析绑定 → openai/anthropic
 * 双协议取 JSON → schema 校验 → ai_runs / ai_usage_events 记账（不记 prompt
 * 与产物正文，summary ≤8KB）。错误 {retryable, code} 仿 AsrError，可重试交队列退避。
 */

const LLM_TIMEOUT_MS = 120_000
const SUMMARY_MAX_BYTES = 8 * 1024

export type LlmPurpose = 'llm' | 'vlm' | 'image'

export class LlmError extends Error {
  /** true = 可重试（网络/超时/429/5xx/坏 JSON/截断）；false = 终态失败（配置缺失、schema 不符）。 */
  readonly retryable: boolean
  readonly code: string
  /** 上游已返回时的用量（失败调用也要入台账，否则重试的花费不可见）。 */
  readonly tokensIn: number | null
  readonly tokensOut: number | null

  constructor(
    message: string,
    options: { retryable: boolean; code: string; tokensIn?: number | null; tokensOut?: number | null },
  ) {
    super(message)
    this.name = 'LlmError'
    this.retryable = options.retryable
    this.code = options.code
    this.tokensIn = options.tokensIn ?? null
    this.tokensOut = options.tokensOut ?? null
  }
}

export type LlmChannel = {
  modelId: string
  model: string
  provider: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
}

/** 任务键 → 主模型条目；无绑定时回落该用途的默认条目（迭代 4 再做主备切换）。 */
export async function resolveTaskChannel(
  task: string,
  purpose: LlmPurpose,
): Promise<LlmChannel> {
  const binding = await findBinding(task)
  const row: ModelRow | null = binding
    ? await findModelById(binding.primary_model_id)
    : await findDefaultModel(purpose)
  if (!row) {
    throw new LlmError(`任务 ${task} 未绑定模型`, { retryable: false, code: 'model_not_configured' })
  }
  if (row.status === 'disabled') {
    throw new LlmError(`任务 ${task} 绑定的模型已禁用`, { retryable: false, code: 'model_not_configured' })
  }
  const apiKey = openSecret(row.api_key_enc)
  if (!apiKey || !row.base_url) {
    throw new LlmError(`任务 ${task} 绑定的模型密钥或 Base URL 缺失`, {
      retryable: false,
      code: 'model_not_configured',
    })
  }
  return {
    modelId: row.id,
    model: row.model,
    provider: row.provider,
    protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: normalizeBaseUrl(row.base_url),
    apiKey,
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/** 多模态消息携带的图片（base64，adapter 按协议封装）。 */
export type LlmImage = { mediaType: 'image/jpeg' | 'image/png'; base64: string }

type RawCompletion = { text: string; tokensIn: number | null; tokensOut: number | null }

function upstreamSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 200)
}

async function callOpenai(
  channel: LlmChannel,
  input: { system: string; user: string; maxTokens: number; images?: LlmImage[] },
  fetchImpl: FetchLike,
): Promise<RawCompletion> {
  const userContent =
    input.images && input.images.length > 0
      ? [
          { type: 'text', text: input.user },
          ...input.images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          })),
        ]
      : input.user
  let res: Response
  try {
    res = await fetchImpl(`${channel.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${channel.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: channel.model,
        max_tokens: input.maxTokens,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new LlmError('模型调用超时', { retryable: true, code: 'llm_timeout' })
    }
    throw new LlmError(`模型连接失败：${(err as Error).message}`, {
      retryable: true,
      code: 'llm_network',
    })
  }
  const text = await res.text()
  if (res.status === 429 || res.status >= 500) {
    throw new LlmError(`上游返回 ${res.status}：${upstreamSnippet(text)}`, {
      retryable: true,
      code: 'llm_upstream',
    })
  }
  if (res.status < 200 || res.status >= 300) {
    throw new LlmError(`上游返回 ${res.status}：${upstreamSnippet(text)}`, {
      retryable: false,
      code: 'llm_upstream',
    })
  }
  const payload = JSON.parse(text) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const tokensIn = payload.usage?.prompt_tokens ?? null
  const tokensOut = payload.usage?.completion_tokens ?? null
  if (payload.choices?.[0]?.finish_reason === 'length') {
    throw new LlmError('模型输出因 max_tokens 截断，JSON 不完整', {
      retryable: true,
      code: 'llm_truncated',
      tokensIn,
      tokensOut,
    })
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new LlmError('模型返回空内容', { retryable: true, code: 'llm_bad_json' })
  }
  return {
    text: content,
    tokensIn,
    tokensOut,
  }
}

async function callAnthropic(
  channel: LlmChannel,
  input: { system: string; user: string; maxTokens: number; images?: LlmImage[] },
  fetchImpl: FetchLike,
): Promise<RawCompletion> {
  const userContent = [
    ...(input.images ?? []).map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
    })),
    { type: 'text', text: input.user },
  ]
  let res: Response
  try {
    res = await fetchImpl(`${channel.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': channel.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: channel.model,
        max_tokens: input.maxTokens,
        temperature: 0.2,
        system: input.system,
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new LlmError('模型调用超时', { retryable: true, code: 'llm_timeout' })
    }
    throw new LlmError(`模型连接失败：${(err as Error).message}`, {
      retryable: true,
      code: 'llm_network',
    })
  }
  const text = await res.text()
  if (res.status === 429 || res.status >= 500) {
    throw new LlmError(`上游返回 ${res.status}：${upstreamSnippet(text)}`, {
      retryable: true,
      code: 'llm_upstream',
    })
  }
  if (res.status < 200 || res.status >= 300) {
    throw new LlmError(`上游返回 ${res.status}：${upstreamSnippet(text)}`, {
      retryable: false,
      code: 'llm_upstream',
    })
  }
  const payload = JSON.parse(text) as {
    content?: { type: string; text?: string }[]
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  if (payload.stop_reason === 'max_tokens') {
    // 推理型模型的思考与正文共用 max_tokens 预算：截断是可再试的（换次思考长度往往就过）。
    throw new LlmError('模型输出因 max_tokens 截断，JSON 不完整', {
      retryable: true,
      code: 'llm_truncated',
      tokensIn: payload.usage?.input_tokens ?? null,
      tokensOut: payload.usage?.output_tokens ?? null,
    })
  }
  const content = (payload.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
  if (content.length === 0) {
    throw new LlmError('模型返回空内容', { retryable: true, code: 'llm_bad_json' })
  }
  return {
    text: content,
    tokensIn: payload.usage?.input_tokens ?? null,
    tokensOut: payload.usage?.output_tokens ?? null,
  }
}

function clipSummary(summary: string): string {
  const clipped = summary.slice(0, SUMMARY_MAX_BYTES)
  return clipped === summary ? clipped : `${clipped}…`
}

export async function startRun(input: {
  task: string
  refType: string
  refId: string
  channel: LlmChannel
  runId: string
}): Promise<void> {
  await query(
    `INSERT INTO ai_runs (id, source, task_key, ref_type, ref_id, model_id, model, provider, status)
     VALUES ($1, 'producer', $2, $3, $4, $5, $6, $7, 'running')`,
    [
      input.runId,
      input.task,
      input.refType,
      input.refId,
      input.channel.modelId,
      input.channel.model,
      input.channel.provider,
    ],
  )
}

export async function finishRun(input: {
  runId: string
  tokensIn: number | null
  tokensOut: number | null
  latencyMs: number
  summary: string
}): Promise<void> {
  await query(
    `UPDATE ai_runs
     SET status = 'succeeded', tokens_in = $2, tokens_out = $3, latency_ms = $4,
         summary = $5, finished_at = now()
     WHERE id = $1`,
    [input.runId, input.tokensIn, input.tokensOut, input.latencyMs, clipSummary(input.summary)],
  )
  if (input.tokensIn !== null || input.tokensOut !== null) {
    await query(
      `INSERT INTO ai_usage_events (id, run_id, kind, tokens_in, tokens_out)
       VALUES ($1, $2, 'tokens', $3, $4)`,
      [newId('aiUsage'), input.runId, input.tokensIn, input.tokensOut],
    )
  }
}

export async function failRun(input: {
  runId: string
  code: string
  message: string
  tokensIn?: number | null
  tokensOut?: number | null
}): Promise<void> {
  await query(
    `UPDATE ai_runs
     SET status = 'failed', tokens_in = $3, tokens_out = $4, summary = $2, finished_at = now()
     WHERE id = $1`,
    [
      input.runId,
      clipSummary(`${input.code}: ${input.message}`),
      input.tokensIn ?? null,
      input.tokensOut ?? null,
    ],
  )
  // 上游已回的用量照样入台账：失败调用（尤其会重试的）花了钱不能不算。
  if (input.tokensIn != null || input.tokensOut != null) {
    await query(
      `INSERT INTO ai_usage_events (id, run_id, kind, tokens_in, tokens_out)
       VALUES ($1, $2, 'tokens', $3, $4)`,
      [newId('aiUsage'), input.runId, input.tokensIn ?? null, input.tokensOut ?? null],
    )
  }
}

/**
 * 任务级 JSON 调用：解析绑定 → 双协议取文本 → JSON.parse → schema 校验，
 * 全程记账 ai_runs（succeeded 记 tokens/时延/摘要；failed 记错误码）。
 * 本迭代 source 固定 producer（生产侧调用，arch/07 §10 口径）。
 */
export async function runLlmJson<T>(input: {
  task: string
  purpose: LlmPurpose
  refType: string
  refId: string
  system: string
  user: string
  maxTokens: number
  images?: LlmImage[]
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
  summarize?: (data: T) => string
  /** 阶段标记（outline / draft…）：写进 ai_runs.summary 前缀，供工作台按阶段归类调用。 */
  phase?: string
  fetchImpl?: FetchLike
}): Promise<{ data: T; runId: string }> {
  const channel = await resolveTaskChannel(input.task, input.purpose)
  const runId = newId('aiRun')
  await startRun({ task: input.task, refType: input.refType, refId: input.refId, channel, runId })

  const started = Date.now()
  const prefix = input.phase ? `${input.phase}: ` : ''
  try {
    const fetchImpl = input.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init))
    const raw =
      channel.protocol === 'anthropic'
        ? await callAnthropic(channel, input, fetchImpl)
        : await callOpenai(channel, input, fetchImpl)

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.text)
    } catch {
      throw new LlmError('模型输出不是合法 JSON', { retryable: true, code: 'llm_bad_json' })
    }
    const result = input.schema.safeParse(parsed)
    if (!result.success) {
      throw new LlmError(`模型输出不符合约定结构：${result.error.message.slice(0, 200)}`, {
        retryable: true,
        code: 'llm_schema',
      })
    }

    const latencyMs = Date.now() - started
    await finishRun({
      runId,
      tokensIn: raw.tokensIn,
      tokensOut: raw.tokensOut,
      latencyMs,
      summary: prefix + (input.summarize ? input.summarize(result.data) : 'ok'),
    })
    return { data: result.data, runId }
  } catch (err) {
    const isLlm = err instanceof LlmError
    await failRun({
      runId,
      code: prefix + (isLlm ? err.code : 'llm_internal'),
      message: (err as Error).message,
      tokensIn: isLlm ? err.tokensIn : null,
      tokensOut: isLlm ? err.tokensOut : null,
    }).catch(() => undefined)
    if (isLlm) throw err
    throw new LlmError(`模型调用失败：${(err as Error).message}`, {
      retryable: true,
      code: 'llm_internal',
    })
  }
}
