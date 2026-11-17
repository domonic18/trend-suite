/**
 * 端点拼接（arch/07 §9.1）。
 *
 * baseUrl 有两种写法：根地址（https://api.minimax.cn）与带版本前缀
 * （https://api.minimax.cn/v1）。MiniMax 专有端点自带 /v1，运营台两种都
 * 可能填——按「末段是不是版本号（v1、v4…）」决定要不要补 /v1，
 * 免得拼出 /v1/v1/speech_to_text 这种双前缀 404。
 */

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** 末段是版本号（v1、v4…）时视为已带版本前缀。 */
function hasVersionPrefix(baseUrl: string): boolean {
  const last = trimSlash(baseUrl).split('/').pop() ?? ''
  return /^v\d+$/i.test(last)
}

/** MiniMax 专有端点：{baseUrl}/v1{path}（已带版本前缀就不重复补）。 */
function minimaxPath(baseUrl: string, path: string): string {
  const base = trimSlash(baseUrl)
  return hasVersionPrefix(base) ? `${base}${path}` : `${base}/v1${path}`
}

/** MiniMax 语音识别端点。 */
export function minimaxAsrUrl(baseUrl: string): string {
  return minimaxPath(baseUrl, '/speech_to_text')
}

/**
 * 图像生成端点。
 * - `modern`：H3-Image 系列（POST /v1/images/generations）
 * - `legacy`：image-01 系列（POST /v1/image_generation）
 */
export function minimaxImageUrl(baseUrl: string, variant: 'modern' | 'legacy'): string {
  return variant === 'modern'
    ? minimaxPath(baseUrl, '/images/generations')
    : minimaxPath(baseUrl, '/image_generation')
}
