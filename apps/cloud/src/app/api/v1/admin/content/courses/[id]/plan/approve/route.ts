import { planView, workbenchRoles } from '@trend-suite/contracts'
import { approvePlan } from '@/server/content/plans/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/plan/approve：批准草案锁定基准版（服务端挡未决项）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const plan = await approvePlan(user, id)
    return json({ plan: planView.parse(plan) })
  } catch (err) {
    return errorResponse(err)
  }
}
