import { ingestResponse, workbenchRoles } from '@trend-suite/contracts'
import { retryAsset } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 重试失败的加工：只补没做完的部分（已转块、已抽帧保留，不重复计费）。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const result = await retryAsset(user, id)
    return json(ingestResponse.parse(result), 202)
  } catch (err) {
    return errorResponse(err)
  }
}
