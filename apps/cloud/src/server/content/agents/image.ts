import 'server-only'
import { minimaxImageUrl } from '@/server/models/endpoints'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import {
  failRun,
  LlmError,
  resolveTaskChannel,
  startRun,
  type FetchLike,
} from './llm'

/**
 * 文生图通道（arch/07 §9 图像生成端点行）：解析 purpose='image' 绑定 →
 * H3-Image 新端点（/v1/images/generations），404 回落老版 image-01
 * （/v1/image_generation）。图像模型绝不走聊天端点——协议非 openai 直接终态失败。
 * 记账：ai_runs 一行（succeeded 记时延与张数摘要），ai_usage_events kind='images'
 * tokens_out=张数（图像调用不回 token，账本口径按张计）。
 */

const IMAGE_TIMEOUT_MS = 120_000

export const FIGURE_GENERATED_TASK = 'content.figure_generated'

export type ImageRunResult = {
  base64: string
  runId: string
  modelId: string
  model: string
}

export async function runImageGeneration(input: {
  prompt: string
  refType: string
  refId: string
  fetchImpl?: FetchLike
}): Promise<ImageRunResult> {
  const channel = await resolveTaskChannel(FIGURE_GENERATED_TASK, 'image')
  if (channel.protocol !== 'openai') {
    throw new LlmError('图像模型只支持 openai 协议端点', {
      retryable: false,
      code: 'image_protocol_unsupported',
    })
  }
  const runId = newId('aiRun')
  await startRun({
    task: FIGURE_GENERATED_TASK,
    refType: input.refType,
    refId: input.refId,
    channel,
    runId,
  })

  const started = Date.now()
  const headers = {
    authorization: `Bearer ${channel.apiKey}`,
    'content-type': 'application/json',
  }
  const body = JSON.stringify({ model: channel.model, prompt: input.prompt, n: 1 })
  const fetchImpl = input.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init))

  try {
    const { base64, endpoint } = await callImageEndpoint({
      channel,
      headers,
      body,
      fetchImpl,
    })
    const latencyMs = Date.now() - started
    await finishImageRun({ runId, latencyMs, summary: `generated: 1 张图（${endpoint}）` })
    return { base64, runId, modelId: channel.modelId, model: channel.model }
  } catch (err) {
    const isLlm = err instanceof LlmError
    await failRun({
      runId,
      code: isLlm ? err.code : 'image_internal',
      message: (err as Error).message,
    }).catch(() => undefined)
    if (isLlm) throw err
    throw new LlmError(`图像生成失败：${(err as Error).message}`, {
      retryable: true,
      code: 'image_internal',
    })
  }
}

async function callImageEndpoint(input: {
  channel: { baseUrl: string; model: string }
  headers: Record<string, string>
  body: string
  fetchImpl: FetchLike
}): Promise<{ base64: string; endpoint: 'modern' | 'legacy' }> {
  let lastError: LlmError | null = null
  for (const variant of ['modern', 'legacy'] as const) {
    let res: Response
    try {
      res = await input.fetchImpl(minimaxImageUrl(input.channel.baseUrl, variant), {
        method: 'POST',
        headers: input.headers,
        body: input.body,
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      })
    } catch (err) {
      if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
        throw new LlmError('图像生成超时', { retryable: true, code: 'image_timeout' })
      }
      throw new LlmError(`图像通道连接失败：${(err as Error).message}`, {
        retryable: true,
        code: 'image_network',
      })
    }
    const text = await res.text()
    if (res.status === 404 || res.status === 405) {
      // 新端点不存在（老版 image-01 上游）——回落老端点再试一次。
      lastError = new LlmError(`图像端点 ${res.status}`, { retryable: true, code: 'image_upstream' })
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      throw new LlmError(`图像上游返回 ${res.status}：${snippet(text)}`, {
        retryable: true,
        code: 'image_upstream',
      })
    }
    if (res.status < 200 || res.status >= 300) {
      throw new LlmError(`图像上游返回 ${res.status}：${snippet(text)}`, {
        retryable: false,
        code: 'image_upstream',
      })
    }
    const payload = JSON.parse(text) as {
      data?: { b64_json?: string; image_base64?: string } | { image_base64?: string }
      base_resp?: { status_code?: number; status_msg?: string }
    }
    // MiniMax 鉴权失败是 HTTP 200 + base_resp.status_code != 0，只看 HTTP 状态会把失败当成功。
    const baseCode = payload.base_resp?.status_code
    if (typeof baseCode === 'number' && baseCode !== 0) {
      throw new LlmError(`图像上游拒绝：${payload.base_resp?.status_msg ?? `错误码 ${baseCode}`}`, {
        retryable: false,
        code: 'image_upstream',
      })
    }
    const base64 =
      (Array.isArray(payload.data) ? payload.data[0]?.b64_json : payload.data?.image_base64) ?? null
    if (typeof base64 !== 'string' || base64.length === 0) {
      throw new LlmError('图像上游没有返回图片数据', { retryable: true, code: 'image_empty' })
    }
    return { base64, endpoint: variant }
  }
  throw lastError ?? new LlmError('上游没有图像生成端点', { retryable: false, code: 'image_upstream' })
}

/** 图像调用收尾：ai_runs 记时延摘要，ai_usage_events kind='images' 按张入账。 */
async function finishImageRun(input: {
  runId: string
  latencyMs: number
  summary: string
}): Promise<void> {
  await query(
    `UPDATE ai_runs
     SET status = 'succeeded', latency_ms = $2, summary = $3, finished_at = now()
     WHERE id = $1`,
    [input.runId, input.latencyMs, input.summary.slice(0, 8 * 1024)],
  )
  await query(
    `INSERT INTO ai_usage_events (id, run_id, kind, tokens_in, tokens_out)
     VALUES ($1, $2, 'images', NULL, 1)`,
    [newId('aiUsage'), input.runId],
  )
}

function snippet(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 200)
}
