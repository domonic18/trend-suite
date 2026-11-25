import { agentPhase, stopAgentRunResponse, workbenchRoles } from '@trend-suite/contracts'
import { stopAgentRun } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /v1/admin/content/courses/[id]/agent/[phase]/stop：停止本阶段的在途对话回复（轮边界安全中止）。 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; phase: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, phase } = await params
    const parsedPhase = agentPhase.safeParse(phase)
    if (!parsedPhase.success) throw badRequest('未知的对话阶段')
    const data = await stopAgentRun(user, id, parsedPhase.data)
    return json(stopAgentRunResponse.parse(data))
  } catch (err) {
    return errorResponse(err)
  }
}
