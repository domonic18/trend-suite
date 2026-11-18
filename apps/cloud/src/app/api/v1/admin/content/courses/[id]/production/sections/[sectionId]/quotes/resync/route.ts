import { resyncQuotesResponse, workbenchRoles } from '@trend-suite/contracts'
import { resyncProductionQuotes } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/production/sections/[sectionId]/quotes/resync：只重置步骤 2/3 再重投。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, sectionId } = await params
    const result = await resyncProductionQuotes(user, id, sectionId)
    return json(resyncQuotesResponse.parse(result))
  } catch (err) {
    return errorResponse(err)
  }
}
