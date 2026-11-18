import { sectionQuotesResponse, workbenchRoles } from '@trend-suite/contracts'
import { getSectionQuotes } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /v1/admin/content/courses/[id]/production/sections/[sectionId]/quotes：节行情视图（清单 + bars + 常驻声明）。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, sectionId } = await params
    const quotes = await getSectionQuotes(user, id, sectionId)
    return json(sectionQuotesResponse.parse({ quotes }))
  } catch (err) {
    return errorResponse(err)
  }
}
