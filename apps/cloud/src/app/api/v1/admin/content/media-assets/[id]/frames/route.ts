import { mediaFrameListResponse, workbenchRoles } from '@trend-suite/contracts'
import { getFrames } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 关键帧列表：帧地址是应用自身的取图路由（带会话校验）。 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const frames = await getFrames(user, id)
    return json(mediaFrameListResponse.parse(frames))
  } catch (err) {
    return errorResponse(err)
  }
}
