import 'server-only'
import type { SessionUser } from '@trend-suite/contracts'
import { resolveSession } from '@/server/accounts/service'
import { forbidden, unauthenticated } from './http'

/** 会话令牌只走 Authorization 头——浏览器会话令牌存 sessionStorage，不落 Cookie。 */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization')
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer') return null
  const trimmed = token?.trim()
  return trimmed ? trimmed : null
}

export async function requireUser(req: Request, roles?: readonly string[]): Promise<SessionUser> {
  const token = bearerToken(req)
  if (!token) throw unauthenticated()
  const user = await resolveSession(token)
  if (!user) throw unauthenticated('会话已失效，请重新登录')
  if (roles && !roles.includes(user.role)) throw forbidden('当前角色无权执行该操作')
  return user
}
