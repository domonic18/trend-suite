import { agentPhase, workbenchRoles } from '@trend-suite/contracts'
import { stream } from '@/server/agent-chat/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TICK_MS = 1_000
const HEARTBEAT_MS = 15_000
const MAX_LIFETIME_MS = 10 * 60_000

/**
 * GET /v1/admin/content/courses/[id]/agent/[phase]/events?cursor=：SSE 事件流
 * （arch/08 §3 主通道）。帧 = agentStreamResponse（id 帧游标），消息或元态
 * （agentBusy/pendingQuestionId）变化才写帧，~15s 心跳注释行；接受
 * Last-Event-ID 续传；连接 10 分钟主动收口由客户端重连。
 * 鉴权只走 Authorization 头（无 Cookie），客户端用 fetch 流式读取 + 手写解析。
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
    let cursor = Number(url.searchParams.get('cursor') ?? lastEventId ?? 0)
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0

    const encoder = new TextEncoder()
    const startedAt = Date.now()
    let lastSignature = ''
    let lastBeat = Date.now()

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false
        const close = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            // 客户端已断开
          }
        }
        req.signal.addEventListener('abort', close)
        try {
          while (!closed && !req.signal.aborted && Date.now() - startedAt < MAX_LIFETIME_MS) {
            const snap = await stream(user, id, parsedPhase.data, cursor)
            const signature = `${snap.cursor}|${snap.agentBusy}|${snap.pendingQuestionId ?? ''}`
            const hasNews = snap.messages.length > 0
            if (hasNews || signature !== lastSignature) {
              if (hasNews) cursor = snap.cursor
              lastSignature = signature
              controller.enqueue(
                encoder.encode(
                  `id: ${cursor}\nevent: agent\ndata: ${JSON.stringify(snap)}\n\n`,
                ),
              )
              lastBeat = Date.now()
            } else if (Date.now() - lastBeat >= HEARTBEAT_MS) {
              controller.enqueue(encoder.encode(': hb\n\n'))
              lastBeat = Date.now()
            }
            await new Promise((resolve) => setTimeout(resolve, TICK_MS))
          }
        } catch {
          // 查库异常：直接收口，客户端会带游标重连
        }
        close()
      },
    })

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
