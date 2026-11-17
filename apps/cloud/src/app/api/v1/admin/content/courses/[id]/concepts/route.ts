import { conceptsResponse, workbenchRoles } from '@trend-suite/contracts'
import { listConceptsFor } from '@/server/content/plans/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /v1/admin/content/courses/[id]/concepts：批准后落库的概念与依赖（只读）。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const data = await listConceptsFor(user, id)
    return json(conceptsResponse.parse(data))
  } catch (err) {
    return errorResponse(err)
  }
}
