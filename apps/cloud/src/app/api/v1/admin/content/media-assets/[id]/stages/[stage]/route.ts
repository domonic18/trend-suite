import {
  deleteMediaStageResponse,
  mediaStage,
  workbenchRoles,
} from '@trend-suite/contracts'
import { assetViewOf } from '@/server/pipeline/asset-view'
import { deleteStage } from '@/server/pipeline/stages'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 删除某一段分析的结果：素材字节与另外两段不受影响。
 * 理解结果被方案引用时拒绝（409）——课程内容会悬空。
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; stage: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, stage: raw } = await ctx.params
    const stage = mediaStage.safeParse(raw)
    if (!stage.success) throw badRequest('未知的分析段')
    const asset = await deleteStage(user, id, stage.data)
    return json(deleteMediaStageResponse.parse({ asset: await assetViewOf(asset) }))
  } catch (err) {
    return errorResponse(err)
  }
}
