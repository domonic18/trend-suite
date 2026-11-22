import {
  mediaStage,
  rerunMediaStageRequest,
  rerunMediaStageResponse,
  workbenchRoles,
} from '@trend-suite/contracts'
import { assetViewOf } from '@/server/pipeline/asset-view'
import { rerunStage } from '@/server/pipeline/stages'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 重跑某一段分析：只跑这一段，另外两段的产物保留。
 * force 缺省 = 只补缺口（去重，不重复计费）；force=true = 先清掉该段结果再重来。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; stage: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, stage: raw } = await ctx.params
    const stage = mediaStage.safeParse(raw)
    if (!stage.success) throw badRequest('未知的分析段')
    const raw_body = await req.json().catch(() => ({}))
    const parsed = rerunMediaStageRequest.safeParse(raw_body ?? {})
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))

    const result = await rerunStage(user, id, stage.data, parsed.data.force === true)
    return json(
      rerunMediaStageResponse.parse({
        asset: await assetViewOf(result.asset),
        jobId: result.jobId,
      }),
      202,
    )
  } catch (err) {
    return errorResponse(err)
  }
}
