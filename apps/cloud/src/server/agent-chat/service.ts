import 'server-only'
import {
  answerQuestionRequest,
  sendMessageRequest,
  type AgentMessageView,
  type AgentPhase,
  type AnswerQuestionResponse,
  type SendMessageResponse,
  type SessionUser,
  type AgentStreamResponse,
  agentStreamResponse,
} from '@trend-suite/contracts'
import { badRequest, conflict, forbidden, notFound } from '@/server/lib/http'
import { queryOne } from '@/server/lib/db'
import { getCourseForUser } from '@/server/content/service'
import { approvePlan, rejectPlanInternal } from '@/server/content/plans/service'
import { resumeProductionInternal, retryProductionSectionInternal } from '@/server/production/service'
import { enqueueJob } from '@/server/pipeline/jobs/repo'
import { AGENT_CHAT_JOB_KIND } from './steps'
import {
  findOpenThread,
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

  // 先原子抢占 answeredIndex（只允许一次），抢到才落 answer 行——并发双击在这里兜底。
  const wrote = await writebackAnsweredIndex(messageId, body.optionIndex)
  if (!wrote) throw conflict('该确认卡已回答')
  const answer = await insertMessage(thread.id, 'answer', {
    questionMessageId: messageId,
    optionIndex: body.optionIndex,
    label: option.label,
  })

  // 选项绑定的确定性动作：服务端直接执行，不经模型（红线）。结果落 event 消息。
  await runBoundAction(actor, courseId, thread, option)

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
  if (!thread) {
    return agentStreamResponse.parse({ messages: [], cursor, agentBusy: false, pendingQuestionId: null })
  }
  const [rows, busy, pending] = await Promise.all([
    listMessagesFrom(thread.id, cursor),
    hasBusyAgentJob(courseId),
    unansweredQuestion(thread.id),
  ])
  const nextCursor = rows.length > 0 ? Number(rows[rows.length - 1]!.seq) : cursor
  return agentStreamResponse.parse({
    messages: rows.map(rowView),
    cursor: nextCursor,
    agentBusy: busy,
    pendingQuestionId: pending?.id ?? null,
  })
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
