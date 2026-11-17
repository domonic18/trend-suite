import 'server-only'
import { minimaxAsrUrl, minimaxImageUrl } from './endpoints'

/**
 * 连通性测试（arch/07 §9.1）：与正式调用走同一协议分支，
 * 避免「测试通、实际不通」。测试请求真实发出，会计费。
 */

const TEST_TIMEOUT_MS = 30_000

export type TestOutcome = { ok: boolean; message: string }

/** 0.5 秒静音 16kHz 单声道 WAV：够跑通协议分支，不含任何真实内容。 */
function silentWav(): Buffer {
  const sampleRate = 16_000
  const samples = Math.floor(sampleRate * 0.5)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return buffer
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: FormData | string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * MiniMax 的错误体有两种：HTTP 4xx（type/error/message）与 HTTP 200 +
 * base_resp.status_code != 0（鉴权失败即如此）。只看 HTTP 状态会把失败
 * 当成连通——这里把 base_resp 也判掉。
 */
function baseRespError(text: string): string | null {
  try {
    const payload = JSON.parse(text) as {
      base_resp?: { status_code?: number; status_msg?: string }
    }
    const code = payload.base_resp?.status_code
    if (typeof code === 'number' && code !== 0) {
      return payload.base_resp?.status_msg ?? `上游错误码 ${code}`
    }
  } catch {
    // 非 JSON 响应，交给调用方按 HTTP 状态判定
  }
  return null
}

export async function testAsrChannel(input: {
  baseUrl: string | null
  apiKey: string
  model: string
}): Promise<TestOutcome> {
  if (!input.baseUrl) return { ok: false, message: '未配置 Base URL' }
  const form = new FormData()
  form.append('model', input.model || 'asr-1.0')
  form.append('file', new Blob([new Uint8Array(silentWav())], { type: 'audio/wav' }), 'probe.wav')
  form.append('response_format', 'json')
  form.append('stream', 'false')

  try {
    const { status, text } = await post(
      minimaxAsrUrl(input.baseUrl),
      {
        authorization: `Bearer ${input.apiKey}`,
      },
      form,
    )
    if (status >= 200 && status < 300) return { ok: true, message: '转写通道连通' }
    return { ok: false, message: `上游返回 ${status}：${text.slice(0, 160)}` }
  } catch (err) {
    return { ok: false, message: `连接失败：${(err as Error).message}` }
  }
}

/**
 * 图像生成通道（文生图）：H3-Image 系列走 /v1/images/generations，
 * 老版 image-01 走 /v1/image_generation——新端点不存在（404）时回落老端点。
 */
export async function testImageModel(input: {
  baseUrl: string | null
  apiKey: string
  model: string
  fetchImpl?: typeof fetch
}): Promise<TestOutcome> {
  if (!input.baseUrl) return { ok: false, message: '未配置 Base URL' }
  const headers = {
    authorization: `Bearer ${input.apiKey}`,
    'content-type': 'application/json',
  }
  const body = JSON.stringify({ model: input.model, prompt: '连通性测试：一个红色圆点', n: 1 })

  for (const variant of ['modern', 'legacy'] as const) {
    try {
      const { status, text } = await post(
        minimaxImageUrl(input.baseUrl, variant),
        headers,
        body,
        input.fetchImpl,
      )
      if (status === 404 || status === 405) continue
      const baseError = baseRespError(text)
      if (baseError) return { ok: false, message: `上游拒绝：${baseError.slice(0, 160)}` }
      if (status >= 200 && status < 300) return { ok: true, message: '图像通道连通' }
      return { ok: false, message: `上游返回 ${status}：${text.slice(0, 160)}` }
    } catch (err) {
      return { ok: false, message: `连接失败：${(err as Error).message}` }
    }
  }
  return { ok: false, message: '上游没有图像生成端点（/images/generations 与 /image_generation 均 404）' }
}

export async function testChatModel(input: {
  protocol: string
  baseUrl: string | null
  apiKey: string
  model: string
}): Promise<TestOutcome> {
  if (!input.baseUrl) return { ok: false, message: '未配置 Base URL' }
  try {
    if (input.protocol === 'anthropic') {
      const { status, text } = await post(
        `${input.baseUrl}/v1/messages`,
        {
          'x-api-key': input.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        JSON.stringify({
          model: input.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      )
      if (status >= 200 && status < 300) return { ok: true, message: '模型通道连通' }
      return { ok: false, message: `上游返回 ${status}：${text.slice(0, 160)}` }
    }

    const { status, text } = await post(
      `${input.baseUrl}/chat/completions`,
      {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      JSON.stringify({
        model: input.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    )
    if (status >= 200 && status < 300) return { ok: true, message: '模型通道连通' }
    return { ok: false, message: `上游返回 ${status}：${text.slice(0, 160)}` }
  } catch (err) {
    return { ok: false, message: `连接失败：${(err as Error).message}` }
  }
}

export async function testEmbeddingModel(input: {
  baseUrl: string | null
  apiKey: string
  model: string
}): Promise<TestOutcome> {
  if (!input.baseUrl) return { ok: false, message: '未配置 Base URL' }
  try {
    const { status, text } = await post(
      `${input.baseUrl}/embeddings`,
      {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      JSON.stringify({ model: input.model, input: 'ping', dimensions: 1024 }),
    )
    if (status >= 200 && status < 300) return { ok: true, message: '向量通道连通' }
    return { ok: false, message: `上游返回 ${status}：${text.slice(0, 160)}` }
  } catch (err) {
    return { ok: false, message: `连接失败：${(err as Error).message}` }
  }
}
