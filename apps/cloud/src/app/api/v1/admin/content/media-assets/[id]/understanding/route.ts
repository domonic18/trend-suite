import {
  mediaUnderstandingResponse,
  workbenchRoles,
} from '@trend-suite/contracts'
import { getUnderstanding } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 视频理解段的产物：讲解要点与出处时间码。 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const items = await getUnderstanding(user, id)
    return json(mediaUnderstandingResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}
