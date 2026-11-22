import 'server-only'
import { query, queryOne } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'

/**
 * 制作事件流（教师端需求 T21）：教师端制作页的「Agent 正在做什么」。
 *
 * 九步引擎原本只留当前状态（production_tasks）——教师看不到过程，也看不到
 * 停止点。这里补一条只增不改的事件流：seq 单调递增即游标，前端带游标续读。
 *
 * 纪律：只记事实（步状态、模型调用、停止动作），**不记模型措辞**——
 * 模型说了什么在教材正文里，事件流只回答「做了什么、花了多少」。
 */

export type ProductionEventRow = {
  id: string
  course_id: string
  section_id: string | null
  seq: string
  kind: 'step' | 'tool' | 'stop'
  step: number | null
  title: string
  detail: string | null
  payload: Record<string, unknown>
  created_at: Date
}

const COLUMNS =
  'id, course_id, section_id, seq, kind, step, title, detail, payload, created_at'

export async function recordEvent(input: {
  courseId: string
  sectionId?: string | null
  kind: ProductionEventRow['kind']
  step?: number | null
  title: string
  detail?: string | null
  payload?: Record<string, unknown>
}): Promise<void> {
  await query(
    `INSERT INTO production_events
       (id, course_id, section_id, kind, step, title, detail, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      newId('productionEvent'),
      input.courseId,
      input.sectionId ?? null,
      input.kind,
      input.step ?? null,
      input.title,
      input.detail ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  )
}

/** 增量读：seq 大于游标的事件（升序）。 */
export function listEvents(courseId: string, afterSeq: string | null): Promise<ProductionEventRow[]> {
  return query<ProductionEventRow>(
    `SELECT ${COLUMNS} FROM production_events
      WHERE course_id = $1 AND ($2::bigint IS NULL OR seq > $2::bigint)
      ORDER BY seq ASC
      LIMIT 200`,
    [courseId, afterSeq],
  )
}

/** 最新一条停止事件（停止点：教师上次按停在哪）。 */
export function findLastStopEvent(courseId: string): Promise<ProductionEventRow | null> {
  return queryOne<ProductionEventRow>(
    `SELECT ${COLUMNS} FROM production_events
      WHERE course_id = $1 AND kind = 'stop'
      ORDER BY seq DESC LIMIT 1`,
    [courseId],
  ) as Promise<ProductionEventRow | null>
}

/** 事件里已记过的模型调用 id（避免同一次调用重复记两张卡）。 */
export function listRecordedRunIds(courseId: string, runIds: string[]): Promise<string[]> {
  if (runIds.length === 0) return Promise.resolve([])
  return query<{ run_id: string }>(
    `SELECT DISTINCT payload->>'runId' AS run_id
       FROM production_events
      WHERE course_id = $1 AND payload ? 'runId'
        AND payload->>'runId' = ANY($2::text[])`,
    [courseId, runIds],
  ).then((rows) => rows.map((row) => row.run_id).filter((id): id is string => !!id))
}
