import 'server-only'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { getEnv } from '@/env'
import { parseAsrResponse, type AsrResult } from './parse'

/**
 * ASR 通道客户端（arch/07 §9.1）：
 * - `minimax`：MiniMax 专有协议 POST {baseUrl}/v1/speech_to_text
 * - `openai`：OpenAI 兼容 POST {baseUrl}/audio/transcriptions
 * 两者都拿回带时间戳的段落，解析口径统一在 parse.ts。
 */

export type AsrProtocol = 'minimax' | 'openai'

export type AsrChannel = {
  baseUrl: string
  apiKey: string
  model: string
  protocol: AsrProtocol
}

export class AsrError extends Error {
  /** true = 可重试（429/5xx/网络）；false = 终态失败（参数非法、媒体非法）。 */
  readonly retryable: boolean
  readonly code: string

  constructor(message: string, options: { retryable: boolean; code: string }) {
    super(message)
    this.name = 'AsrError'
    this.retryable = options.retryable
    this.code = options.code
  }
}

const TIMEOUT_MS = 120_000

export async function transcribeFile(
  channel: AsrChannel,
  filePath: string,
): Promise<AsrResult> {
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), basename(filePath))
  form.append('model', channel.model || 'asr-1.0')

  const url =
    channel.protocol === 'minimax'
      ? `${channel.baseUrl}/v1/speech_to_text`
      : `${channel.baseUrl}/audio/transcriptions`

  if (channel.protocol === 'minimax') {
    form.append('response_format', 'verbose_json')
    form.append('timestamp_level', 'sentence')
    form.append('stream', 'false')
  } else {
    form.append('response_format', 'verbose_json')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${channel.apiKey}` },
      body: form,
      signal: controller.signal,
    })
  } catch (err) {
    throw new AsrError(`ASR 调用失败：${(err as Error).message}`, {
      retryable: true,
      code: 'asr_network_error',
    })
  } finally {
    clearTimeout(timer)
  }

  const raw = await res.text()
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500
    throw new AsrError(`ASR 上游返回 ${res.status}：${raw.slice(0, 200)}`, {
      retryable,
      code: retryable ? 'asr_upstream_error' : 'asr_rejected',
    })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new AsrError('ASR 返回结果无法解析', { retryable: true, code: 'asr_bad_response' })
  }
  return parseAsrResponse(payload)
}

/** ASR 单条时长上限（秒）：超限上游直接拒，不截断。 */
export function asrMaxAudioSeconds(): number {
  return getEnv().PIPELINE_CHUNK_SECONDS
}
