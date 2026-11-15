import { loginRequest, loginResponse } from '@trend-suite/contracts'
import { startSession } from '@/server/accounts/service'
import { badRequest, errorResponse, firstIssueOf, invalidCredentials, json, tooManyRequests } from '@/server/lib/http'
import { check, forgive, hit } from '@/server/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 同一来源 + 同一用户名：5 分钟内 10 次失败即拒，防口令爆破。 */
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000

/**
 * 限流键取真实来源 IP：反向代理会把客户端 IP 追加到 X-Forwarded-For 末尾，
 * 末位才是我们自己那一跳写入的可信值（首位可被客户端伪造）。
 */
function rateLimitKey(req: Request, username: string): string {
  const forwarded = req.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',').pop()?.trim() || 'unknown'
  return `${ip}|${username}`
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null)
    const parsed = loginRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }

    const key = rateLimitKey(req, parsed.data.username)
    const verdict = check(key, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
    if (!verdict.allowed) {
      throw tooManyRequests(`登录尝试过于频繁，请 ${verdict.retryAfterS} 秒后再试`)
    }

    const session = await startSession(parsed.data.username, parsed.data.password)
    if (!session) {
      hit(key, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)
      throw invalidCredentials()
    }
    forgive(key)

    return json(loginResponse.parse(session))
  } catch (err) {
    return errorResponse(err)
  }
}
