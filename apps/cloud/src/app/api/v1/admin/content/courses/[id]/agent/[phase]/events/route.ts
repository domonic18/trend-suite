import { agentPhase, workbenchRoles } from '@trend-suite/contracts'
import { agentEventsStream, assertChatReadable } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /v1/admin/content/courses/[id]/agent/[phase]/events?cursor=
 * SSE 事件流（arch/08 §3 主通道）：帧复用 agentStreamResponse，变化才出帧。
 * 节奏与心跳等业务逻辑在 service.agentEventsStream——本层只鉴权与转发。
 * 鉴权在建立流之前完成（流内抛错无法回传 HTTP 状态码）。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; phase: string }> },
) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id, phase } = await params
    const parsedPhase = agentPhase.safeParse(phase)
    if (!parsedPhase.success) throw badRequest('未知的对话阶段')
    const url = new URL(req.url)
    const lastEventId = req.headers.get('last-event-id')
    const parsedCursor = Number(url.searchParams.get('cursor') ?? lastEventId ?? 0)
    const cursor = Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0
    await assertChatReadable(user, id)
    const body = agentEventsStream(id, parsedPhase.data, cursor, req.signal)
    return new Response(body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}
