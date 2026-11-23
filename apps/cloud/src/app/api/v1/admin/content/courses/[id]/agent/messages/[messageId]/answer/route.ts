import { answerQuestionResponse, workbenchRoles } from '@trend-suite/contracts'
import { answerQuestion } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /v1/admin/content/courses/[id]/agent/messages/[messageId]/answer：
 * 回答确认卡 → 选项绑定的确定性动作由服务端执行 → 入队续跑 agent run。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, messageId } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw badRequest('请求体不是合法 JSON')
    }
    const data = await answerQuestion(user, id, messageId, body)
    return json(answerQuestionResponse.parse(data))
  } catch (err) {
    return errorResponse(err)
  }
}
