import 'server-only'
import {
  answerQuestionRequest,
  sendMessageRequest,
  type AgentMessageView,
  type AgentPhase,
  type AnswerQuestionResponse,
  type SendMessageResponse,
  type SessionUser,
  type StopAgentRunResponse,
  type AgentStreamResponse,
  agentStreamResponse,
} from '@trend-suite/contracts'
import { badRequest, conflict, forbidden, notFound } from '@/server/lib/http'
import { queryOne } from '@/server/lib/db'
import { getCourseForUser } from '@/server/content/service'
import { approvePlan, rejectPlanInternal } from '@/server/content/plans/service'
import { resumeProductionInternal, retryProductionSectionInternal } from '@/server/production/service'
import { cancelJob, enqueueJob, findJobByCourse, requestCancel } from '@/server/pipeline/jobs/repo'
import { AGENT_CHAT_JOB_KIND } from './steps'
import {
  findOpenThread,
  findPendingThread,
  findPendingThreadOtherThan,
  findThreadById,
  hasBusyAgentJob,
  ensureOpenThread,
  insertMessage,
  listMessagesFrom,
  toMessageView,
  unansweredQuestion,
  writebackAnsweredIndex,
  type AgentThreadRow,
} from './repo'

/**
 * 会话服务（arch/08 §4）：sendMessage / answerQuestion / stream。
 * 写动作限做课人（producer 限本人课程，admin 兼具）；operator 只读 stream。
 * 红线：approve_plan 等确认类动作由答案处理器按教师所选选项确定性执行，
 * 不经模型（模型工具白名单里没有它们）。
 */

/** 对话写动作的权限口径：与 plans service 的 requireOwnedCourse 一致。 */
async function requireChatActor(actor: SessionUser, courseId: string): Promise<void> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以执行该操作')
  }
}

/** SSE 节奏：忙时 1s、空闲 2.5s；心跳 15s；单连接最长 10 分钟。 */
const BUSY_TICK_MS = 1_000
const IDLE_TICK_MS = 2_500
const HEARTBEAT_MS = 15_000
const MAX_LIFETIME_MS = 10 * 60_000

export async function sendMessage(
  actor: SessionUser,
  courseId: string,
  phase: AgentPhase,
  input: unknown,
): Promise<SendMessageResponse> {
  await requireChatActor(actor, courseId)
  const body = sendMessageRequest.parse(input)
  const thread = await ensureOpenThread(actor.id, courseId, phase)
  const row = await insertMessage(thread.id, 'user', { text: body.text })
  // 总是入队：无在途任务则新建；有在途任务则复用（引擎在收口时为待处理线程续跑）。
  await enqueueJob({ courseId, kind: AGENT_CHAT_JOB_KIND })
  return { message: rowView(row) }
}

export async function answerQuestion(
  actor: SessionUser,
  courseId: string,
  messageId: string,
  input: unknown,
): Promise<AnswerQuestionResponse> {
  await requireChatActor(actor, courseId)
  const body = answerQuestionRequest.parse(input)
  // 线程从消息本身解析（方案页与制作台共用回答端点），并校验归属课程。
  const row = await queryOne<AgentMessageRowShape>(
    `SELECT id, thread_id, seq, role, payload, ai_run_id, created_at
     FROM agent_messages WHERE id = $1`,
    [messageId],
  )
  if (!row || row.role !== 'question') {
    throw notFound('确认卡不存在')
  }
  const thread = await findThreadById(row.thread_id)
  if (!thread || thread.course_id !== courseId || thread.status !== 'open') {
    throw notFound('确认卡不存在')
  }
  const question = (row.payload as { question?: QuestionPayload }).question
  if (!question) throw notFound('确认卡数据损坏')
  if (question.answeredIndex !== null && question.answeredIndex !== undefined) {
    throw conflict('该确认卡已回答')
  }
  const option = question.options?.[body.optionIndex]
  if (!option) throw badRequest('选项不存在')

  // 双轨分流（arch/08 §4）：模型中断卡先验「仍是最新未答卡」——被后续提问/输入
  // 取代的卡不可补答（对应 interrupt 已按新输入 resume，409 防过期）。
  const source = (row.payload as { source?: 'agent' | 'server' }).source ?? 'server'
  if (source === 'agent') {
    const latest = await unansweredQuestion(thread.id)
    if (latest?.id !== messageId) throw conflict('该提问已被后续提问取代')
  }

  // 先原子抢占 answeredIndex（只允许一次），抢到才落 answer 行——并发双击在这里兜底。
  const wrote = await writebackAnsweredIndex(messageId, body.optionIndex)
  if (!wrote) throw conflict('该确认卡已回答')
  const answer = await insertMessage(thread.id, 'answer', {
    questionMessageId: messageId,
    optionIndex: body.optionIndex,
    label: option.label,
    note: body.note?.trim() ? body.note.trim() : null,
  })

  // server 卡：选项绑定的确定性动作由服务端直接执行，不经模型（红线）。
  // 结果落 event 消息。agent 卡选项无动作，续跑交给引擎 Command(resume)。
  if (source === 'server') {
    await runBoundAction(actor, courseId, thread, option)
  }

  await enqueueJob({ courseId, kind: AGENT_CHAT_JOB_KIND })
  return { message: rowView(answer) }
}

type BoundOption = { label: string; description?: string | null; action?: string; planId?: string; sectionId?: string }

async function runBoundAction(
  actor: SessionUser,
  courseId: string,
  thread: AgentThreadRow,
  option: BoundOption,
): Promise<void> {
  if (!option.action) return
  try {
    if (option.action === 'approve_plan') {
      await approvePlan(actor, courseId)
      await insertMessage(thread.id, 'event', {
        kind: 'plan_approved',
        detail: '方案已批准并锁定为基准版，制作已解锁（九步生产从第一节开始）。',
        level: 'ok',
      })
    } else if (option.action === 'revise_plan') {
      const view = await rejectPlanInternal(courseId, '（教师通过确认卡选择打回修订）', actor.id)
      await insertMessage(thread.id, 'event', {
        kind: 'plan_revision_started',
        detail: `已打回当前草案，正在按意见重新起草（新版本 v${view.version}）。`,
        level: 'info',
      })
    } else if (option.action === 'resume_production') {
      // 停止确认卡的「改完继续制作」：内部变体自记 production_resumed 事件。
      await resumeProductionInternal(courseId)
    } else if (option.action === 'retry_section') {
      // 停止确认卡的「放弃本节重做」：内部变体自记 section_retried 事件。
      const sectionId = option.sectionId
      if (!sectionId) throw new Error('确认卡没有绑定要重做的节')
      await retryProductionSectionInternal(courseId, sectionId)
    } else {
      await insertMessage(thread.id, 'event', {
        kind: 'action_unknown',
        detail: `确认卡动作 ${option.action} 未注册，已忽略。`,
        level: 'err',
      })
    }
  } catch (err) {
    // 门禁拦截等业务失败：失败原因回灌对话流（arch/08 §5.3）
    await insertMessage(thread.id, 'event', {
      kind: 'approval_blocked',
      detail: `动作未执行：${(err as Error).message}`,
      level: 'err',
    })
  }
}

export async function stream(
  actor: SessionUser,
  courseId: string,
  phase: AgentPhase,
  cursor: number,
): Promise<AgentStreamResponse> {
  await getCourseForUser(actor, courseId)
  const thread = await findOpenThread(courseId, phase)
  return snapshotOf(thread?.id ?? null, cursor)
}

/** 线程快照（增量消息 + 忙闲 + 待答卡）——鉴权已在调用方完成。 */
async function snapshotOf(threadId: string | null, cursor: number): Promise<AgentStreamResponse> {
  if (!threadId) {
    return agentStreamResponse.parse({ messages: [], cursor, agentBusy: false, pendingQuestionId: null })
  }
  const [rows, busy, pending] = await Promise.all([
    listMessagesFrom(threadId, cursor),
    hasBusyAgentJob(threadId),
    unansweredQuestion(threadId),
  ])
  const nextCursor = rows.length > 0 ? Number(rows[rows.length - 1]!.seq) : cursor
  return agentStreamResponse.parse({
    messages: rows.map(rowView),
    cursor: nextCursor,
    agentBusy: busy,
    pendingQuestionId: pending?.id ?? null,
  })
}

/** 读取权限校验（事件流在建立连接前调用一次——流内再抛错无法回传 HTTP 状态）。 */
export async function assertChatReadable(actor: SessionUser, courseId: string): Promise<void> {
  await getCourseForUser(actor, courseId)
}

/** SSE 事件流（arch/08 §3）：忙时 1s tick、空闲 2.5s，消息或元态变化才出帧；
 *  ~15s 心跳；10 分钟主动收口由客户端重连。鉴权由调用方在建流前完成。 */
export function agentEventsStream(
  courseId: string,
  phase: AgentPhase,
  cursor0: number,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const startedAt = Date.now()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = cursor0
      let lastSignature = ''
      let lastBeat = Date.now()
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
      signal.addEventListener('abort', close)
      try {
        const thread = await findOpenThread(courseId, phase)
        const threadId = thread?.id ?? null
        while (!closed && !signal.aborted && Date.now() - startedAt < MAX_LIFETIME_MS) {
          const snap = await snapshotOf(threadId, cursor)
          const signature = `${snap.cursor}|${snap.agentBusy}|${snap.pendingQuestionId ?? ''}`
          if (snap.messages.length > 0) {
            cursor = snap.cursor
            lastSignature = signature
            controller.enqueue(encoder.encode(`id: ${cursor}\nevent: agent\ndata: ${JSON.stringify(snap)}\n\n`))
            lastBeat = Date.now()
          } else if (signature !== lastSignature) {
            lastSignature = signature
            controller.enqueue(encoder.encode(`id: ${cursor}\nevent: agent\ndata: ${JSON.stringify(snap)}\n\n`))
            lastBeat = Date.now()
          } else if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            controller.enqueue(encoder.encode(': hb\n\n'))
            lastBeat = Date.now()
          }
          await new Promise((resolve) => setTimeout(resolve, snap.agentBusy ? BUSY_TICK_MS : IDLE_TICK_MS))
        }
      } catch {
        // 查库异常：直接收口，客户端会带游标重连
      }
      close()
    },
  })
}

/**
 * 停止本阶段的在途对话回复（arch/08 §3）：对课程的在途 agent_chat job 请求
 * 协作取消——running 的任务由引擎在轮边界安全中止并落 chat_stopped 事件；
 * 还在队列里的任务直接取消并代为落事件。要处理的是其它阶段线程、或没有
 * 在途任务时不动（幂等返回 stopped=false）。
 */
export async function stopAgentRun(
  actor: SessionUser,
  courseId: string,
  phase: AgentPhase,
): Promise<StopAgentRunResponse> {
  await requireChatActor(actor, courseId)
  const job = await findJobByCourse({ courseId, kind: AGENT_CHAT_JOB_KIND })
  if (!job || (job.status !== 'queued' && job.status !== 'running')) {
    return { stopped: false }
  }
  if (job.status === 'running') {
    // 引擎把正在处理的线程 id 写在 step 列：不是本阶段的线程就不动它。
    const runningThread = job.step ? await findThreadById(job.step) : null
    if (runningThread && runningThread.phase !== phase) return { stopped: false }
    await requestCancel(job.id)
    return { stopped: true }
  }
  // 队列态：确认接下来要处理的正是本阶段的线程才取消（requestCancel 只对
  // running 生效）；取消后代落 chat_stopped 事件（引擎不会再跑），其它阶段
  // 的待处理输入续投不断供。
  const next = await findPendingThread(courseId)
  if (!next || next.phase !== phase) return { stopped: false }
  await cancelJob(job.id)
  const thread = await findOpenThread(courseId, phase)
  if (thread) {
    await insertMessage(thread.id, 'event', {
      kind: 'chat_stopped',
      detail: '你停止了本轮回复；已发送的消息不会丢，可以重新发起。',
      level: 'info',
    })
  }
  const other = await findPendingThreadOtherThan(courseId, next.id)
  if (other) await enqueueJob({ courseId, kind: AGENT_CHAT_JOB_KIND })
  return { stopped: true }
}

// ---------------------------------------------------------------- 内部形状

type AgentMessageRowShape = {
  id: string
  thread_id: string
  seq: string
  role: AgentMessageView['role']
  payload: Record<string, unknown>
  ai_run_id: string | null
  created_at: Date
}

type QuestionPayload = {
  text?: string
  options?: BoundOption[]
  answeredIndex?: number | null
}

function rowView(row: AgentMessageRowShape): AgentMessageView {
  return toMessageView(row)
}
