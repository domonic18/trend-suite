import { resumeProductionResponse, workbenchRoles } from '@trend-suite/contracts'
import { resumeProduction } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/production/resume：继续制作（从停下的地方续跑，已完成的步不重跑）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const result = await resumeProduction(user, id)
    return json(resumeProductionResponse.parse(result))
  } catch (err) {
    return errorResponse(err)
  }
}
