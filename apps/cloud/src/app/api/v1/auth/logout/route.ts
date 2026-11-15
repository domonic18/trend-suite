import { logoutResponse } from '@trend-suite/contracts'
import { endSession } from '@/server/accounts/service'
import { bearerToken } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const token = bearerToken(req)
    if (token) await endSession(token)
    return json(logoutResponse.parse({ ok: true }))
  } catch (err) {
    return errorResponse(err)
  }
}
