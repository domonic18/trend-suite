import 'server-only'
import type { PoolClient } from 'pg'
import { query, queryOne } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { MAX_ATTEMPTS } from './limits'
import { STEP_COUNT } from './steps'

/**
 * 逐节九步生产的数据访问（arch/03 §2.2 production_tasks / sections）。
 * 不变量：(course_id, section_id, step) 唯一 = 幂等 upsert 锚点（重放防重复）；
 * sections.status pending → complete，对外只认 complete（绝不部分落库）。
 */

export type ProductionTaskRow = {
  id: string
  course_id: string
  section_id: string
  step: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'pending_manual'
  attempts: number
  last_error: string | null
  checkpoint: Record<string, unknown>
  heartbeat_at: Date | null
  created_at: Date
  updated_at: Date
}

export type SectionRow = {
  id: string
  course_id: string
  section_id: string
  title: string
  sort_order: number
  status: 'pending' | 'complete'
  placeholder: Record<string, unknown>
  body_status: 'none' | 'draft' | 'rejected'
  created_at: Date
  updated_at: Date
}

const TASK_COLUMNS =
  'id, course_id, section_id, step, status, attempts, last_error, checkpoint, heartbeat_at, created_at, updated_at'
const SECTION_COLUMNS =
  'id, course_id, section_id, title, sort_order, status, placeholder, body_status, created_at, updated_at'

/**
 * 批准方案时播种：每节 9 行 pending 任务 + sections 行。
 * 幂等：ON CONFLICT DO NOTHING——批准微调后新节补种，既有节不复活（断点语义）。
 */
export async function seedProduction(
  courseId: string,
  sections: { sectionId: string; title: string; order: number }[],
  tx?: PoolClient,
): Promise<void> {
  const exec: (sql: string, params: unknown[]) => Promise<unknown> = tx
    ? (sql, params) => tx.query(sql, params)
    : (sql, params) => query(sql, params)
  for (const section of sections) {
    await exec(
      `INSERT INTO sections (id, course_id, section_id, title, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, section_id) DO NOTHING`,
      [newId('section'), courseId, section.sectionId, section.title, section.order],
    )
    for (let step = 1; step <= STEP_COUNT; step++) {
      await exec(
        `INSERT INTO production_tasks (id, course_id, section_id, step)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course_id, section_id, step) DO NOTHING`,
        [newId('productionTask'), courseId, section.sectionId, step],
      )
    }
  }
}

export function listSections(courseId: string): Promise<SectionRow[]> {
  return query<SectionRow>(
    `SELECT ${SECTION_COLUMNS} FROM sections WHERE course_id = $1 ORDER BY sort_order ASC`,
    [courseId],
  )
}

export function listTasks(courseId: string): Promise<ProductionTaskRow[]> {
  return query<ProductionTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM production_tasks WHERE course_id = $1 ORDER BY section_id, step ASC`,
    [courseId],
  )
}

/**
 * 认领该节下一步（顺序强制）：step = 最小的 pending，且更小步全 done。
 * 跑错序在此被结构性挡住——不是 pending 或前序未 done 都认领不到。
 * FOR UPDATE SKIP LOCKED：同节多 worker 也只认领一次。
 */
export async function claimNextStep(courseId: string, sectionId: string): Promise<ProductionTaskRow | null> {
  return queryOne<ProductionTaskRow>(
    `WITH next_task AS (
       SELECT t.id FROM production_tasks t
       WHERE t.course_id = $1 AND t.section_id = $2 AND t.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM production_tasks prev
           WHERE prev.course_id = t.course_id AND prev.section_id = t.section_id
             AND prev.step < t.step AND prev.status <> 'done'
         )
       ORDER BY t.step ASC LIMIT 1
       FOR UPDATE
     )
     UPDATE production_tasks task
     SET status = 'running', attempts = task.attempts + 1, heartbeat_at = now(), updated_at = now()
     FROM next_task
     WHERE task.id = next_task.id
     RETURNING task.id, task.course_id, task.section_id, task.step, task.status, task.attempts,
               task.last_error, task.checkpoint, task.heartbeat_at, task.created_at, task.updated_at`,
    [courseId, sectionId],
  ) as Promise<ProductionTaskRow | null>
}

/** 步完成（幂等）：只有 running 行可翻 done；第 9 步完成同事务翻 sections.complete。 */
export async function completeStep(task: ProductionTaskRow, output?: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE production_tasks
     SET status = 'done',
         checkpoint = CASE WHEN $2::jsonb IS NULL THEN checkpoint ELSE checkpoint || $2::jsonb END,
         last_error = NULL, heartbeat_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running'`,
    [task.id, output ? JSON.stringify(output) : null],
  )
  if (task.step === STEP_COUNT) {
    await query(
      `UPDATE sections SET status = 'complete', updated_at = now()
       WHERE course_id = $1 AND section_id = $2`,
      [task.course_id, task.section_id],
    )
  }
}

/**
 * 步失败：回灌语义（arch/05 §7）——attempts 未达上限回 pending 重写（带原因），
 * 达上限转 pending_manual 人工待办（绝不静默丢弃）。
 */
export async function failStep(task: ProductionTaskRow, message: string): Promise<'pending' | 'pending_manual'> {
  const next: 'pending' | 'pending_manual' = task.attempts >= MAX_ATTEMPTS ? 'pending_manual' : 'pending'
  await query(
    `UPDATE production_tasks
     SET status = $2, last_error = $3, heartbeat_at = now(), updated_at = now()
     WHERE id = $1`,
    [task.id, next, message.slice(0, 500)],
  )
  return next
}

/**
 * 崩溃续跑：运行中的任务回 pending（认领时 attempts 已 +1，重跑同一步不重复计数前置产物）。
 * 无条件重置是安全的：活跃 job 唯一索引保证每课只有一个 runner，job 起点的 running 行必是孤儿认领。
 */
export async function resetRunningTasks(courseId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE production_tasks SET status = 'pending', updated_at = now()
     WHERE course_id = $1 AND status = 'running'
     RETURNING id`,
    [courseId],
  )
  return rows.length
}

/** 挂起/失败步人工重试：清零 attempts 回 pending（看板「重试」入口）。 */
export async function retrySection(courseId: string, sectionId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE production_tasks SET status = 'pending', attempts = 0, last_error = NULL, updated_at = now()
     WHERE course_id = $1 AND section_id = $2 AND status IN ('pending_manual', 'failed')
     RETURNING id`,
    [courseId, sectionId],
  )
  return rows.length
}

/**
 * 重新同步行情：只重置步骤 2/3（done/failed/pending_manual → pending、attempts=0），
 * 步骤 1 产物（案例股清单）不动——LLM 付费步不重跑；节回 pending 让 runner 重认领。
 */
export async function resyncQuoteSteps(courseId: string, sectionId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE production_tasks SET status = 'pending', attempts = 0, last_error = NULL, updated_at = now()
     WHERE course_id = $1 AND section_id = $2 AND step IN (2, 3)
       AND status IN ('done', 'failed', 'pending_manual')
     RETURNING id`,
    [courseId, sectionId],
  )
  await query(
    `UPDATE sections SET status = 'pending', updated_at = now()
     WHERE course_id = $1 AND section_id = $2`,
    [courseId, sectionId],
  )
  return rows.length
}

/** 节是否还有 running 步（重新同步的互斥条件）。 */
export async function countRunningTasks(courseId: string, sectionId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*) AS count FROM production_tasks
     WHERE course_id = $1 AND section_id = $2 AND status = 'running'`,
    [courseId, sectionId],
  )
  return Number(row?.count ?? 0)
}

/** 九步全 done 则节翻 complete（幂等）：重同步/重试后无需重跑第 9 步即可复原终态。 */
export async function completeSectionIfAllDone(courseId: string, sectionId: string): Promise<void> {
  await query(
    `UPDATE sections s SET status = 'complete', updated_at = now()
     WHERE s.course_id = $1 AND s.section_id = $2
       AND NOT EXISTS (
         SELECT 1 FROM production_tasks t
         WHERE t.course_id = s.course_id AND t.section_id = s.section_id AND t.status <> 'done'
       )`,
    [courseId, sectionId],
  )
}

export function findSection(courseId: string, sectionId: string): Promise<SectionRow | null> {
  return queryOne<SectionRow>(
    `SELECT ${SECTION_COLUMNS} FROM sections WHERE course_id = $1 AND section_id = $2`,
    [courseId, sectionId],
  )
}

export function findTask(
  courseId: string,
  sectionId: string,
  step: number,
): Promise<ProductionTaskRow | null> {
  return queryOne<ProductionTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM production_tasks
     WHERE course_id = $1 AND section_id = $2 AND step = $3`,
    [courseId, sectionId, step],
  )
}

/** 步后校验用：读当前 checkpoint（agent 工具是否真的写入了产物）。 */
export async function getTaskCheckpoint(taskId: string): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ checkpoint: Record<string, unknown> }>(
    `SELECT checkpoint FROM production_tasks WHERE id = $1`,
    [taskId],
  )
  return row?.checkpoint ?? null
}

/** 预算触线等终态失败：跳过回灌直接挂起（不产出无账本的重试调用）。 */
export async function suspendTask(taskId: string, message: string): Promise<void> {
  await query(
    `UPDATE production_tasks
     SET status = 'pending_manual', last_error = $2, heartbeat_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'running'`,
    [taskId, message.slice(0, 500)],
  )
}

/** 溯源步（第 9 步）计数：本节九步累计的 ai_runs 条数。 */
export async function countSectionRuns(courseId: string, sectionId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM production_tasks t
     JOIN ai_runs r ON r.ref_type = 'production_task' AND r.ref_id = t.id
     WHERE t.course_id = $1 AND t.section_id = $2`,
    [courseId, sectionId],
  )
  return Number(row?.count ?? 0)
}

/** 步产物落 checkpoint（工具侧写入口，幂等覆盖同键）。 */
export async function saveStepOutput(taskId: string, key: string, value: unknown): Promise<void> {
  await query(
    `UPDATE production_tasks SET checkpoint = checkpoint || $2::jsonb, updated_at = now()
     WHERE id = $1`,
    [taskId, JSON.stringify({ [key]: value })],
  )
}

/** 正在跑的步（停止点：教师按下停止时停在哪一步）。 */
export function listRunningTasks(courseId: string): Promise<ProductionTaskRow[]> {
  return query<ProductionTaskRow>(
    `SELECT ${TASK_COLUMNS} FROM production_tasks
      WHERE course_id = $1 AND status = 'running'
      ORDER BY section_id ASC, step ASC`,
    [courseId],
  )
}

export type TaskRunRow = {
  id: string
  model: string
  status: string
  tokens_in: number | null
  tokens_out: number | null
  latency_ms: number | null
  summary: string | null
  created_at: Date
}

/** 步任务的模型调用记录（工具卡的事实来源：模型、耗时、token）。 */
export function listTaskRuns(taskIds: string[]): Promise<TaskRunRow[]> {
  if (taskIds.length === 0) return Promise.resolve([])
  return query<TaskRunRow>(
    `SELECT id, model, status, tokens_in, tokens_out, latency_ms, summary, created_at
       FROM ai_runs
      WHERE ref_type = 'production_task' AND ref_id = ANY($1::text[])
      ORDER BY created_at ASC`,
    [taskIds],
  )
}
