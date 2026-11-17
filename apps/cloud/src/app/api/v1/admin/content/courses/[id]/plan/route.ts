import { planResponse, workbenchRoles } from '@trend-suite/contracts'
import { getPlanFor } from '@/server/content/plans/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /v1/admin/content/courses/[id]/plan：当前方案 + 起草任务状态（轮询）。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const data = await getPlanFor(user, id)
    return json(planResponse.parse(data))
  } catch (err) {
    return errorResponse(err)
  }
}
