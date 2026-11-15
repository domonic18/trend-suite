import { randomBytes } from 'node:crypto'
import { idPrefix, type IdKind } from '@trend-suite/contracts'

/**
 * ID 生成（arch/01 §2.4）：前缀 + 固定长度 hex，与 contracts 的 idShape 一致。
 * 会话令牌长度加倍——它是唯一的凭据材料。
 */
export function newId(kind: IdKind): string {
  const bytes = kind === 'session' ? 16 : 8
  return `${idPrefix[kind]}_${randomBytes(bytes).toString('hex')}`
}
