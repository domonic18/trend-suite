import { cancelMaterialResponse, workbenchRoles } from '@trend-suite/contracts'
import { cancelMaterialProcessing } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 停止加工（教师端需求 T19）：排队中直接取消；运行中置取消标记，
 * worker 在阶段边界安全中止并把素材拨回「已上传」。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const result = await cancelMaterialProcessing(user, id)
    return json(cancelMaterialResponse.parse(result), 200)
  } catch (err) {
    return errorResponse(err)
  }
}
