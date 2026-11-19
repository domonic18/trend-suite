import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/env'
import { HttpError } from '@/server/lib/http'

/**
 * HLS 短时签名地址（arch/05 §3.3）：播放器直接取 playlist 与分片，带不上
 * Authorization 头——签发一次覆盖 `hls/<assetId>` 整个前缀（playlist + 全部分片），
 * 分片请求复用 playlist 的 exp/sig（本模块 rewritePlaylist 负责把查询串补写进
 * 每个分片行，hls.js 解析相对地址时会丢掉 base 的 query）。
 *
 * 签名域用字面量 'hls' 作 scope：与帧签名（assetId+frameId）域不同，且不存在
 * 任何对 `sources/` 前缀签名的通道——源文件只走服务端管线内部读取。
 */

const HLS_URL_TTL_MS = 6 * 60 * 60 * 1000

export function signHlsPlaybackUrl(input: { assetId: string }): { url: string; expiresAt: string } {
  const expiresAt = Date.now() + HLS_URL_TTL_MS
  const sig = sign(input.assetId, expiresAt)
  return {
    url: `/v1/media/hls/${input.assetId}/index.m3u8?exp=${expiresAt}&sig=${sig}`,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

export function verifyHlsSignature(input: {
  assetId: string
  exp: string | null
  sig: string | null
}): void {
  if (!input.exp || !input.sig) {
    throw new HttpError(403, 'forbidden', 'HLS 地址缺少签名')
  }
  const expiresAt = Number(input.exp)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(403, 'forbidden', 'HLS 地址已过期')
  }
  const expected = Buffer.from(sign(input.assetId, expiresAt), 'utf8')
  const actual = Buffer.from(input.sig, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(403, 'forbidden', 'HLS 地址签名不匹配')
  }
}

/**
 * 把 playlist 里的分片行补上签名查询串（hls.js 按相对地址解析时会丢 base 的 query）。
 * 只改非注释、非空行；EXT-X-MAP 等带引号 URI 的行由调用方保证本管线不产生（单码流无 init 段）。
 */
export function rewritePlaylist(playlist: string, exp: string, sig: string): string {
  const suffix = `?exp=${exp}&sig=${sig}`
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed === '' || trimmed.startsWith('#')) return line
      if (trimmed.includes('?')) return line
      return `${trimmed}${suffix}`
    })
    .join('\n')
}

function sign(assetId: string, expiresAt: number): string {
  const secret = getEnv().MEDIA_UPLOAD_SECRET
  if (!secret) {
    throw new HttpError(503, 'internal_error', 'HLS 服务未启用：服务端未配置签名密钥')
  }
  return createHmac('sha256', secret)
    .update(['hls', assetId, String(expiresAt)].join('\n'))
    .digest('hex')
}
