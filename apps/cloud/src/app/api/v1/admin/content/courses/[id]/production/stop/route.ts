import { stopProductionResponse, workbenchRoles } from '@trend-suite/contracts'
import { stopProduction } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/production/stop：停止制作（步边界安全中止，成果保留）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const stop = await stopProduction(user, id)
    return json(stopProductionResponse.parse({ ok: true, stop }))
  } catch (err) {
    return errorResponse(err)
  }
}
