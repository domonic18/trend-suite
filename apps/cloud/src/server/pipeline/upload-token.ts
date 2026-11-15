import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getEnv } from '@/env'
import { badRequest, HttpError } from '@/server/lib/http'

/**
 * 直传凭据（arch/05 §3.1）：HMAC 绑定「素材 + 字节数 + 摘要 + 有效期」。
 * 服务端只验签——凭据本身不含任何素材内容，也不泄漏存储凭据。
 */

const HMAC_HEADERS = {
  token: 'x-upload-token',
  sha256: 'x-file-sha256',
} as const

export function uploadTokenHeaderName(): string {
  return HMAC_HEADERS.token
}

export function uploadSha256HeaderName(): string {
  return HMAC_HEADERS.sha256
}

export function signUploadToken(input: {
  assetId: string
  byteSize: number
  sha256?: string | undefined
  expiresAt: Date
}): string {
  const secret = uploadSecret()
  const payload = [
    input.assetId,
    String(input.byteSize),
    input.sha256 ?? '',
    input.expiresAt.toISOString(),
  ].join('\n')
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function verifyUploadToken(input: {
  assetId: string
  byteSize: number
  sha256?: string | undefined
  expiresAt: Date
  token: string
}): void {
  if (input.expiresAt.getTime() <= Date.now()) {
    throw badRequest('直传凭据已过期，请重新发起上传')
  }
  const expected = Buffer.from(
    signUploadToken({
      assetId: input.assetId,
      byteSize: input.byteSize,
      sha256: input.sha256,
      expiresAt: input.expiresAt,
    }),
    'utf8',
  )
  const actual = Buffer.from(input.token, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw badRequest('直传凭据不匹配')
  }
}

function uploadSecret(): string {
  const secret = getEnv().MEDIA_UPLOAD_SECRET
  if (!secret) {
    throw new HttpError(503, 'internal_error', '直传未启用：服务端未配置 MEDIA_UPLOAD_SECRET')
  }
  return secret
}
