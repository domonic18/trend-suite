/**
 * MiniMax 图像生成响应形状（arch/07 §9.1 图像生成端点行）。
 *
 * 上游有四种回法，都要认：
 * - `data[0].b64_json` / `data[0].image_base64`：直接给 base64
 * - `data[0].url`：给图片地址（H3-Image 新端点的实际回法）→ 要下载图片本体
 * - `data.image_urls[]` / `data.image_url`：老版 image-01 的回法
 *
 * 形状只此一份——连通性测试与正式调用共用同一份解析，避免「测试通、实际不通」
 * （迭代 7 的教训：两边各写一套字段名，服务端判过的客户端认不出）。
 */

export type ImagePayload =
  | { kind: 'base64'; value: string }
  | { kind: 'url'; value: string }
  | { kind: 'none'; reason: string }

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function fromRecord(record: Record<string, unknown>): ImagePayload {
  const base64 = nonEmptyString(record.b64_json) ?? nonEmptyString(record.image_base64)
  if (base64) return { kind: 'base64', value: base64 }

  const url = nonEmptyString(record.url) ?? nonEmptyString(record.image_url)
  if (url) return { kind: 'url', value: url }

  if (Array.isArray(record.image_urls)) {
    const first = record.image_urls.map(nonEmptyString).find((v): v is string => v !== null)
    if (first) return { kind: 'url', value: first }
  }
  return { kind: 'none', reason: 'data 里既没有 b64_json/image_base64 也没有 url/image_urls' }
}

/** 从上游响应体里取出图片（base64 或地址）；没有就说清缺什么。 */
export function extractImagePayload(payload: unknown): ImagePayload {
  const root = readRecord(payload)
  if (!root) return { kind: 'none', reason: '响应不是 JSON 对象' }
  const data = root.data
  if (Array.isArray(data)) {
    const first = readRecord(data[0])
    if (!first) return { kind: 'none', reason: '响应里没有 data' }
    return fromRecord(first)
  }
  const record = readRecord(data)
  if (!record) return { kind: 'none', reason: '响应里没有 data' }
  return fromRecord(record)
}
