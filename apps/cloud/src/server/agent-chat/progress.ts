import 'server-only'
import { query, queryOne } from '@/server/lib/db'
import type { AgentPhase } from '@trend-suite/contracts'
import { ensureOpenThread, insertMessage, type AgentThreadRow } from './repo'

/**
 * 制作进度入对话流（arch/08 §4）：九步引擎的步/模型调用事实与停止/继续动作
 * 都以 event 角色写进 production 线程，替代旧的 production_events 表。
 * 线程不存在时以课程属主名义补建——教师打开制作台即能看到完整留痕。
 * 纪律不变：只记事实（步状态、模型、耗时、token、控制动作），不记模型措辞。
 */

async function courseOwnerId(courseId: string): Promise<string | null> {
  const row = await queryOne<{ owner_id: string }>('SELECT owner_id FROM courses WHERE id = $1', [
    courseId,
  ])
  return row?.owner_id ?? null
}

/** 取或建课程的 phase 线程（worker 语境没有 actor，以课程属主名义建）。 */
export async function ensureCourseThread(
  courseId: string,
  phase: AgentPhase,
): Promise<AgentThreadRow | null> {
  const owner = await courseOwnerId(courseId)
  if (!owner) return null
  return ensureOpenThread(owner, courseId, phase)
}

/** 系统事实入对话流；课程不存在（线程建不了）则静默跳过。extra 供服务端查询，契约读取时剥离。 */
export async function recordProgressEvent(
  courseId: string,
  phase: AgentPhase,
  event: { kind: string; detail: string; level?: 'info' | 'ok' | 'err'; extra?: Record<string, unknown> },
): Promise<void> {
  const thread = await ensureCourseThread(courseId, phase)
  if (!thread) return
  await insertMessage(thread.id, 'event', {
    kind: event.kind,
    detail: event.detail.slice(0, 500),
    level: event.level ?? 'info',
    ...(event.extra ?? {}),
  })
}

/** 带标题的 TODO 卡入对话流（九步引擎的逐节任务清单）；线程建不了则静默跳过。 */
export async function recordProgressTodo(
  courseId: string,
  phase: AgentPhase,
  todo: { title: string; items: { content: string; status: 'pending' | 'doing' | 'done' }[] },
): Promise<void> {
  const thread = await ensureCourseThread(courseId, phase)
  if (!thread) return
  await insertMessage(thread.id, 'todo', { title: todo.title, items: todo.items })
}

type ProgressEventRow = { payload: Record<string, unknown>; created_at: Date }

/** 最近一条指定 kind 的 event 消息（停止点推导等状态判读用）。 */
export async function lastProgressEvent(
  courseId: string,
  phase: AgentPhase,
  kinds: string[],
): Promise<{ kind: string; payload: Record<string, unknown>; createdAt: Date } | null> {
  const row = await queryOne<ProgressEventRow & { kind: string }>(
    `SELECT m.payload->>'kind' AS kind, m.payload, m.created_at
       FROM agent_messages m
       JOIN agent_threads t ON t.id = m.thread_id
      WHERE t.course_id = $1 AND t.phase = $2 AND t.status = 'open' AND m.role = 'event'
        AND m.payload->>'kind' = ANY($3::text[])
      ORDER BY m.seq DESC LIMIT 1`,
    [courseId, phase, kinds],
  )
  if (!row) return null
  return { kind: row.kind, payload: row.payload, createdAt: row.created_at }
}

/** 线程里已记过的模型调用 runId（同一次调用不记两张卡，重跑步时去重）。 */
export async function recordedToolRunIds(
  courseId: string,
  phase: AgentPhase,
  runIds: string[],
): Promise<string[]> {
  if (runIds.length === 0) return []
  const rows = await query<{ run_id: string }>(
    `SELECT DISTINCT m.payload->>'runId' AS run_id
       FROM agent_messages m
       JOIN agent_threads t ON t.id = m.thread_id
      WHERE t.course_id = $1 AND t.phase = $2 AND t.status = 'open' AND m.role = 'event'
        AND m.payload ? 'runId' AND m.payload->>'runId' = ANY($3::text[])`,
    [courseId, phase, runIds],
  )
  return rows.map((row) => row.run_id).filter((id): id is string => !!id)
}
