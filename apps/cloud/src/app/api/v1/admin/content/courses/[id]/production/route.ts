import { productionBoardResponse, workbenchRoles } from '@trend-suite/contracts'
import { getProductionBoard } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /v1/admin/content/courses/[id]/production：九步看板（节行 × 9 步格 + job 态）。 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const board = await getProductionBoard(user, id)
    return json(productionBoardResponse.parse({ board }))
  } catch (err) {
    return errorResponse(err)
  }
}
