import 'server-only'
import { query, queryOne, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { agentMessageView, type AgentMessageView, type AgentPhase } from '@trend-suite/contracts'

/**
 * Agent 会话线程与消息（arch/08 §2）：每课每 phase 至多一个 open 线程
 * （部分唯一索引兜底并发）；消息只追加，seq = 线程内增量游标。
 * 唯一允许的更新是 question 的 answeredIndex 由答案处理器回写一次。
 */

export type AgentThreadRow = {
  id: string
  course_id: string
  phase: AgentPhase
  status: 'open' | 'closed'
  created_by: string
  created_at: Date
  updated_at: Date
}

export type AgentMessageRow = {
  id: string
  thread_id: string
  seq: string
  role: AgentMessageView['role']
  payload: Record<string, unknown>
  ai_run_id: string | null
  created_at: Date
}

const THREAD_COLUMNS = 'id, course_id, phase, status, created_by, created_at, updated_at'
const MESSAGE_COLUMNS = 'id, thread_id, seq, role, payload, ai_run_id, created_at'

export function findOpenThread(courseId: string, phase: AgentPhase): Promise<AgentThreadRow | null> {
  return queryOne<AgentThreadRow>(
    `SELECT ${THREAD_COLUMNS} FROM agent_threads WHERE course_id = $1 AND phase = $2 AND status = 'open'`,
    [courseId, phase],
  )
}

export function findThreadById(id: string): Promise<AgentThreadRow | null> {
  return queryOne<AgentThreadRow>(`SELECT ${THREAD_COLUMNS} FROM agent_threads WHERE id = $1`, [id])
}

/** 取或建 open 线程：并发下靠部分唯一索引兜底，撞了就重读既有线程。 */
export async function ensureOpenThread(
  userId: string,
  courseId: string,
  phase: AgentPhase,
): Promise<AgentThreadRow> {
  const existing = await findOpenThread(courseId, phase)
  if (existing) return existing
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO agent_threads (id, course_id, phase, status, created_by)
       VALUES ($1, $2, $3, 'open', $4)
       ON CONFLICT (course_id, phase) WHERE status = 'open' DO NOTHING`,
      [newId('thread'), courseId, phase, userId],
    )
    const row = await client.query<AgentThreadRow>(
      `SELECT ${THREAD_COLUMNS} FROM agent_threads WHERE course_id = $1 AND phase = $2 AND status = 'open'`,
      [courseId, phase],
    )
    return row.rows[0]!
  })
}

export async function insertMessage(
  threadId: string,
  role: AgentMessageView['role'],
  payload: Record<string, unknown>,
  aiRunId: string | null = null,
): Promise<AgentMessageRow> {
  const inserted = await query<AgentMessageRow>(
    `INSERT INTO agent_messages (id, thread_id, role, payload, ai_run_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING ${MESSAGE_COLUMNS}`,
    [newId('agentMessage'), threadId, role, JSON.stringify(payload), aiRunId],
  )
  return inserted[0]!
}

/** cursor 之后的增量（首拉 cursor=0 即全量）；上限 500 条防一次性拉爆。 */
export function listMessagesFrom(threadId: string, cursor: number): Promise<AgentMessageRow[]> {
  return query<AgentMessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM agent_messages WHERE thread_id = $1 AND seq > $2
     ORDER BY seq ASC LIMIT 500`,
    [threadId, cursor],
  )
}

/**
 * 上一轮 agent 回复之后的用户侧输入（user / answer）与系统动作结果（event）：
 * 这些就是要喂给模型下一轮的「新话」。question/todo 不会出现在这个窗口里。
 */
export async function pendingInputMessages(threadId: string): Promise<AgentMessageRow[]> {
  const rows = await query<AgentMessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM agent_messages
     WHERE thread_id = $1 AND seq > COALESCE((
       SELECT MAX(seq) FROM agent_messages WHERE thread_id = $1 AND role = 'assistant'
     ), 0)
     ORDER BY seq ASC`,
    [threadId],
  )
  return rows.filter((row) => row.role === 'user' || row.role === 'answer' || row.role === 'event')
}

/** 线程内最新一份未回答的确认卡（驱动 pendingQuestionId）。 */
export function unansweredQuestion(threadId: string): Promise<AgentMessageRow | null> {
  return queryOne<AgentMessageRow>(
    `SELECT ${MESSAGE_COLUMNS} FROM agent_messages
     WHERE thread_id = $1 AND role = 'question'
       AND (payload->'question'->>'answeredIndex') IS NULL
     ORDER BY seq DESC LIMIT 1`,
    [threadId],
  )
}

/** 回写 answeredIndex：只允许一次（已回答的确认卡拒绝重复回答）。 */
export async function writebackAnsweredIndex(messageId: string, optionIndex: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE agent_messages
     SET payload = jsonb_set(payload, '{question,answeredIndex}', to_jsonb($2::int))
     WHERE id = $1 AND role = 'question'
       AND (payload->'question'->>'answeredIndex') IS NULL
     RETURNING id`,
    [messageId, optionIndex],
  )
  return rows.length > 0
}

/** 本课程是否有在途 agent_chat 任务（queued/running）——驱动对话流 typing 态。 */
export async function hasBusyAgentJob(courseId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM pipeline_jobs
     WHERE course_id = $1 AND kind = 'agent_chat' AND status IN ('queued','running')
     LIMIT 1`,
    [courseId],
  )
  return row !== null
}

/** 本课程有待处理输入（上一条 assistant 之后的 user/answer）的 open 线程。 */
export async function findPendingThread(courseId: string): Promise<AgentThreadRow | null> {
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM agent_threads t
     WHERE t.course_id = $1 AND t.status = 'open'
       AND EXISTS (
         SELECT 1 FROM agent_messages m
         WHERE m.thread_id = t.id AND m.seq > COALESCE((
           SELECT MAX(seq) FROM agent_messages WHERE thread_id = t.id AND role = 'assistant'
         ), 0) AND m.role IN ('user','answer')
       )
     ORDER BY t.updated_at DESC LIMIT 1`,
    [courseId],
  )
  if (rows.length === 0) return null
  return findThreadById(rows[0]!.id)
}

/** 本课程其它 open 线程里还有没有等处理的输入（跨线程续跑的依据）。 */
export async function findPendingThreadOtherThan(
  courseId: string,
  exceptThreadId: string,
): Promise<AgentThreadRow | null> {
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM agent_threads t
     WHERE t.course_id = $1 AND t.status = 'open' AND t.id <> $2
       AND EXISTS (
         SELECT 1 FROM agent_messages m
         WHERE m.thread_id = t.id AND m.seq > COALESCE((
           SELECT MAX(seq) FROM agent_messages WHERE thread_id = t.id AND role = 'assistant'
         ), 0) AND m.role IN ('user','answer')
       )`,
    [courseId, exceptThreadId],
  )
  if (rows.length === 0) return null
  return findThreadById(rows[0]!.id)
}

/** 课程级系统事件入对话流（起草完成/失败等由其它域回报）；线程不存在则静默跳过。 */
export async function recordSystemEvent(
  courseId: string,
  phase: AgentPhase,
  kind: string,
  detail: string,
  level: 'info' | 'ok' | 'err',
): Promise<void> {
  const thread = await findOpenThread(courseId, phase)
  if (!thread) return
  await insertMessage(thread.id, 'event', { kind, detail, level })
}

// ---------------------------------------------------------------- 视图映射

export function toMessageView(row: AgentMessageRow): AgentMessageView {
  return agentMessageView.parse({
    id: row.id,
    threadId: row.thread_id,
    seq: Number(row.seq),
    createdAt: row.created_at.toISOString(),
    aiRunId: row.ai_run_id,
    role: row.role,
    ...row.payload,
  })
}
