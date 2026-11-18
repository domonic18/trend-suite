import { retryProductionSectionResponse, workbenchRoles } from '@trend-suite/contracts'
import { retryProductionSection } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/production/sections/[sectionId]/retry：挂起节重试（清零回 pending 并重投）。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, sectionId } = await params
    const result = await retryProductionSection(user, id, sectionId)
    return json(retryProductionSectionResponse.parse(result))
  } catch (err) {
    return errorResponse(err)
  }
}
