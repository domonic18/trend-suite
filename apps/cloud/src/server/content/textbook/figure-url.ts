import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/env'
import { HttpError } from '@/server/lib/http'

/**
 * generated 图示成图的短时签名地址：与帧地址同理（<img src> 带不上会话头）。
 * 签名域 scope='figure'——与帧（assetId+frameId）、HLS（'hls'+assetId）互不通用，
 * 且只对 figures 表登记过的 figureId 签发，结构性不接触 sources/。
 */

const FIGURE_URL_TTL_MS = 30 * 60 * 1000

export function signFigureUrl(input: { figureId: string }): string {
  const expiresAt = Date.now() + FIGURE_URL_TTL_MS
  const signature = sign(input.figureId, expiresAt)
  return `/v1/media/figures/${input.figureId}?exp=${expiresAt}&sig=${signature}`
}

export function verifyFigureSignature(input: {
  figureId: string
  exp: string | null
  sig: string | null
}): void {
  if (!input.exp || !input.sig) {
    throw new HttpError(403, 'forbidden', '图示地址缺少签名')
  }
  const expiresAt = Number(input.exp)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(403, 'forbidden', '图示地址已过期')
  }
  const expected = Buffer.from(sign(input.figureId, expiresAt), 'utf8')
  const actual = Buffer.from(input.sig, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(403, 'forbidden', '图示地址签名不匹配')
  }
}

function sign(figureId: string, expiresAt: number): string {
  const secret = getEnv().MEDIA_UPLOAD_SECRET
  if (!secret) {
    throw new HttpError(503, 'internal_error', '图示服务未启用：服务端未配置签名密钥')
  }
  return createHmac('sha256', secret)
    .update(['figure', figureId, String(expiresAt)].join('\n'))
    .digest('hex')
}
