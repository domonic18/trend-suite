import 'server-only'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type { ScryptOptions } from 'node:crypto'
import { getEnv } from '@/env'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

// scrypt 参数：N=16384/r=8/p=1 是 Node 默认档位，够用且不拖慢登录（arch/03 §2.1）。
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64

/** 口令哈希：只存 scrypt 派生值与盐，明文口令永不落库。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, keyB64] = parts
  if (!n || !r || !p || !saltB64 || !keyB64) return false
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(keyB64, 'base64')
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 会话令牌：明文只回给浏览器一次，库里只存哈希。 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ---------------------------------------------------------------- 模型密钥封装
// arch/07 §9.1：密钥 AES-GCM 加密存储，密文形如 v1:<iv>:<tag>:<ciphertext>（base64url）。
// 主密钥来自环境注入，不入库、不进响应。

const SEAL_VERSION = 'v1'
const SEAL_KEY_LEN = 32

export class KeySealUnavailableError extends Error {
  constructor() {
    super('模型密钥主密钥未配置')
    this.name = 'KeySealUnavailableError'
  }
}

function masterKey(): Buffer {
  const raw = getEnv().CREDENTIAL_ENCRYPTION_KEY
  if (!raw) throw new KeySealUnavailableError()
  const key = Buffer.from(raw, 'base64url')
  if (key.length !== SEAL_KEY_LEN) throw new KeySealUnavailableError()
  return key
}

/** 封装：明文密钥 → 可落库的密文。 */
export function sealSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    SEAL_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    enc.toString('base64url'),
  ].join(':')
}

/** 解封：密文 → 明文密钥。解密失败按「未配置」处理（arch/07 §9.1）。 */
export function openSecret(sealed: string | null): string | null {
  if (!sealed) return null
  const parts = sealed.split(':')
  if (parts.length !== 4 || parts[0] !== SEAL_VERSION) return null
  const iv = Buffer.from(parts[1] ?? '', 'base64url')
  const tag = Buffer.from(parts[2] ?? '', 'base64url')
  const data = Buffer.from(parts[3] ?? '', 'base64url')
  try {
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** 密钥掩码：前 4 + * + 后 4。短密钥只回前 4 位。 */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null
  if (plain.length <= 8) return `${plain.slice(0, 4)}*`
  return `${plain.slice(0, 4)}*${plain.slice(-4)}`
}
