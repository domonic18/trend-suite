import { hlsPlaybackResponse, workbenchRoles } from '@trend-suite/contracts'
import { getHlsPlayback } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 管理台预览签发 HLS 播放地址（arch/06 §4）：教师课程权限即可，
 * 学员端按节签发留迭代 9。
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const playback = await getHlsPlayback(user, id)
    return json(hlsPlaybackResponse.parse(playback))
  } catch (err) {
    return errorResponse(err)
  }
}
