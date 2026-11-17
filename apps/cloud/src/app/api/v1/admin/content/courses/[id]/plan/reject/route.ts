import { planView, rejectPlanRequest, workbenchRoles } from '@trend-suite/contracts'
import { rejectPlan } from '@/server/content/plans/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/plan/reject：打回 + 意见 → 新草案重起草。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const raw = await req.json().catch(() => null)
    const parsed = rejectPlanRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const plan = await rejectPlan(user, id, parsed.data)
    return json({ plan: planView.parse(plan) })
  } catch (err) {
    return errorResponse(err)
  }
}
