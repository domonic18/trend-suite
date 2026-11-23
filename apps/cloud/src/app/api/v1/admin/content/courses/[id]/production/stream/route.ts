import { productionStreamResponse, workbenchRoles } from '@trend-suite/contracts'
import { getProductionStream } from '@/server/production/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /v1/admin/content/courses/[id]/production/stream?afterSeq=<游标>
 *
 * Agent 事件流（增量）：游标 = 事件 seq，前端带上次游标续读。
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await params
    const afterSeq = new URL(req.url).searchParams.get('afterSeq')
    const stream = await getProductionStream(user, id, afterSeq)
    return json(productionStreamResponse.parse(stream))
  } catch (err) {
    return errorResponse(err)
  }
}
