import { meResponse } from '@trend-suite/contracts'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    return json(meResponse.parse({ user }))
  } catch (err) {
    return errorResponse(err)
  }
}
