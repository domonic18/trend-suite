import { sectionContentResponse, workbenchRoles } from '@trend-suite/contracts'
import { getSectionContent } from '@/server/content/textbook/section-content'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET 节教材内容视图：正文 DSL 原文 + 图示三路 + 引用单元 + 案例股，
 * 管理台预览单次取全（权限同生产看板）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; sectionId: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, sectionId } = await params
    const content = await getSectionContent(user, id, sectionId)
    return json(sectionContentResponse.parse(content))
  } catch (err) {
    return errorResponse(err)
  }
}
