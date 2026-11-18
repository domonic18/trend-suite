import { deleteMaterialResponse, workbenchRoles } from '@trend-suite/contracts'
import { deleteMaterial } from '@/server/pipeline/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 删除素材（教师端需求 T20）：行、段落、关键帧、任务与已落盘字节一并清理。
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    await deleteMaterial(user, id)
    return json(deleteMaterialResponse.parse({ deleted: true }), 200)
  } catch (err) {
    return errorResponse(err)
  }
}
