import { ingestResponse, workbenchRoles } from '@trend-suite/contracts'
import { rerunUnderstand } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 重跑理解（迭代 8）：只补理解阶段（转写与关键帧保留），按块去重续跑。
 * 智能规划要用素材的教学要点——没有理解结果就没有可规划的要点。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const result = await rerunUnderstand(user, id)
    return json(ingestResponse.parse(result), 202)
  } catch (err) {
    return errorResponse(err)
  }
}
