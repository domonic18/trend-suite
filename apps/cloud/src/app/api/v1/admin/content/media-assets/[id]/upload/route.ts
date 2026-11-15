import { mediaAssetView, workbenchRoles } from '@trend-suite/contracts'
import { receiveUpload } from '@/server/pipeline/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 直传落点（arch/05 §3.1）：浏览器 PUT 字节到此，字节边收边落盘，
 * 不在业务进程内存里攒全量。凭据绑定素材 + 字节数 + 摘要 + 有效期。
 */
export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await context.params
    const asset = await receiveUpload(user, id, req)
    return json(mediaAssetView.parse(asset))
  } catch (err) {
    return errorResponse(err)
  }
}
