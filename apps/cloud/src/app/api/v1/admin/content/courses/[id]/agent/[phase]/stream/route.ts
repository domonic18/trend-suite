import { agentPhase, agentStreamResponse, workbenchRoles } from '@trend-suite/contracts'
import { stream } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /v1/admin/content/courses/[id]/agent/[phase]/stream?cursor=：按 seq 增量轮询（2.5s）。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; phase: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, phase } = await params
    const parsedPhase = agentPhase.safeParse(phase)
    if (!parsedPhase.success) throw badRequest('未知的对话阶段')
    const raw = new URL(req.url).searchParams.get('cursor') ?? '0'
    const cursor = Number(raw)
    if (!Number.isInteger(cursor) || cursor < 0) throw badRequest('cursor 必须是非负整数')
    const data = await stream(user, id, parsedPhase.data, cursor)
    return json(agentStreamResponse.parse(data))
  } catch (err) {
    return errorResponse(err)
  }
}
