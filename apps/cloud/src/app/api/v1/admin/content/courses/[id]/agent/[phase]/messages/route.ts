import { agentPhase, sendMessageResponse, workbenchRoles } from '@trend-suite/contracts'
import { sendMessage } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/agent/[phase]/messages：追加用户消息并入队 agent run。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; phase: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, phase } = await params
    const parsedPhase = agentPhase.safeParse(phase)
    if (!parsedPhase.success) throw badRequest('未知的对话阶段')
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw badRequest('请求体不是合法 JSON')
    }
    const data = await sendMessage(user, id, parsedPhase.data, body)
    return json(sendMessageResponse.parse(data), 201)
  } catch (err) {
    return errorResponse(err)
  }
}
