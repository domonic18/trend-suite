import { planJobResponse, submitPlanInputRequest, workbenchRoles } from '@trend-suite/contracts'
import { savePlanInput } from '@/server/content/plans/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** PUT /v1/admin/content/courses/[id]/plan-input：保存目标与目录，触发起草入队。 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const raw = await req.json().catch(() => null)
    const parsed = submitPlanInputRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const job = await savePlanInput(user, id, parsed.data)
    return json(planJobResponse.parse({ job }))
  } catch (err) {
    return errorResponse(err)
  }
}
