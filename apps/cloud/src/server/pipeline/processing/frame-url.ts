import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/env'
import { HttpError } from '@/server/lib/http'

/**
 * 关键帧短时签名地址（arch/05 §3.6）：帧地址要能直接进 <img src>，
 * 而浏览器带不上 Authorization 头——所以用短时签名代替会话头。
 */

const FRAME_URL_TTL_MS = 30 * 60 * 1000

export function signFrameUrl(input: { assetId: string; frameId: string }): string {
  const expiresAt = Date.now() + FRAME_URL_TTL_MS
  const signature = sign(input.assetId, input.frameId, expiresAt)
  return `/v1/admin/content/media-assets/${input.assetId}/frames/${input.frameId}?exp=${expiresAt}&sig=${signature}`
}

export function verifyFrameSignature(input: {
  assetId: string
  frameId: string
  exp: string | null
  sig: string | null
}): void {
  if (!input.exp || !input.sig) {
    throw new HttpError(403, 'forbidden', '帧地址缺少签名')
  }
  const expiresAt = Number(input.exp)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(403, 'forbidden', '帧地址已过期')
  }
  const expected = Buffer.from(sign(input.assetId, input.frameId, expiresAt), 'utf8')
  const actual = Buffer.from(input.sig, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(403, 'forbidden', '帧地址签名不匹配')
  }
}

function sign(assetId: string, frameId: string, expiresAt: number): string {
  const secret = getEnv().MEDIA_UPLOAD_SECRET
  if (!secret) {
    throw new HttpError(503, 'internal_error', '帧服务未启用：服务端未配置签名密钥')
  }
  return createHmac('sha256', secret)
    .update([assetId, frameId, String(expiresAt)].join('\n'))
    .digest('hex')
}
