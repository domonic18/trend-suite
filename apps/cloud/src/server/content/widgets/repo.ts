import 'server-only'
import type { PoolClient } from 'pg'
import { query, queryOne, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import type { WidgetType } from '@trend-suite/contracts'

/**
 * 课件与断言证明的数据访问（arch/03 §2.2，迁移 012）：
 * - widget_specs (course_id, section_id, type, code) 覆盖键 = 回放课件的幂等锚点
 *   （code 为 NULL 时 PG 视为互不相等 → 其余类型天然「无覆盖键」，同节同类可并存）；
 * - widget_validations 只存**程序证明**记录，无任何学员作答列（arch/06 §11）。
 */

export type WidgetRow = {
  id: string
  course_id: string
  section_id: string
  type: WidgetType
  code: string | null
  spec_version: number
  version: number
  spec: Record<string, unknown>
  created_at: Date
  updated_at: Date
}

export type WidgetValidationRow = {
  widget_id: string
  assertion: string
  status: 'pass' | 'fail'
  params: Record<string, unknown>
  detail: string
  proven_at: Date
}

const WIDGET_COLUMNS =
  'id, course_id, section_id, type, code, spec_version, version, spec, created_at, updated_at'
const VALIDATION_COLUMNS = 'widget_id, assertion, status, params, detail, proven_at'

export function listWidgets(courseId: string, sectionId: string): Promise<WidgetRow[]> {
  return query<WidgetRow>(
    `SELECT ${WIDGET_COLUMNS} FROM widget_specs
     WHERE course_id = $1 AND section_id = $2
     ORDER BY type ASC, code ASC NULLS FIRST, created_at ASC`,
    [courseId, sectionId],
  )
}

export function listCourseWidgets(courseId: string): Promise<WidgetRow[]> {
  return query<WidgetRow>(
    `SELECT ${WIDGET_COLUMNS} FROM widget_specs WHERE course_id = $1 ORDER BY created_at ASC`,
    [courseId],
  )
}

export function findWidgetById(widgetId: string): Promise<WidgetRow | null> {
  return queryOne<WidgetRow>(`SELECT ${WIDGET_COLUMNS} FROM widget_specs WHERE id = $1`, [widgetId])
}

export function listValidations(widgetIds: string[]): Promise<WidgetValidationRow[]> {
  if (widgetIds.length === 0) return Promise.resolve([])
  return query<WidgetValidationRow>(
    `SELECT ${VALIDATION_COLUMNS} FROM widget_validations
     WHERE widget_id = ANY($1::text[]) ORDER BY assertion ASC`,
    [widgetIds],
  )
}

/**
 * 整批替换「其余课件」（步骤 7）：先删本节非回放课件，再落新批。
 * 幂等口径（arch/06 §12 的落地选择）：回灌/重跑不会让课件无限增殖，
 * 而同批内同类型的多份课件仍可并存（无覆盖键）。
 */
export async function replaceSectionWidgets(input: {
  courseId: string
  sectionId: string
  widgets: {
    type: WidgetType
    code: string | null
    specVersion: number
    spec: Record<string, unknown>
    proofs: { assertion: string; params: Record<string, unknown>; detail: string }[]
  }[]
}): Promise<void> {
  await withTransaction(async (tx: PoolClient) => {
    await tx.query(
      `DELETE FROM widget_specs
       WHERE course_id = $1 AND section_id = $2 AND type <> 'bar-replay-decision'`,
      [input.courseId, input.sectionId],
    )
    for (const widget of input.widgets) {
      const id = newId('widget')
      await tx.query(
        `INSERT INTO widget_specs (id, course_id, section_id, type, code, spec_version, spec)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          id,
          input.courseId,
          input.sectionId,
          widget.type,
          widget.code,
          widget.specVersion,
          JSON.stringify(widget.spec),
        ],
      )
      await insertValidations(tx, id, widget.proofs)
    }
  })
}

/**
 * 回放课件按 (节, code) 覆盖写（arch/06 §12）：widgetId 不变、version+1，
 * 证明记录整体替换。
 */
export async function upsertReplayWidget(input: {
  courseId: string
  sectionId: string
  type: WidgetType
  code: string
  specVersion: number
  spec: Record<string, unknown>
  proofs: { assertion: string; params: Record<string, unknown>; detail: string }[]
}): Promise<void> {
  await withTransaction(async (tx: PoolClient) => {
    const row = await tx.query<{ id: string }>(
      `INSERT INTO widget_specs (id, course_id, section_id, type, code, spec_version, spec)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (course_id, section_id, type, code) DO UPDATE SET
         spec = EXCLUDED.spec,
         spec_version = EXCLUDED.spec_version,
         version = widget_specs.version + 1,
         updated_at = now()
       RETURNING id`,
      [
        newId('widget'),
        input.courseId,
        input.sectionId,
        input.type,
        input.code,
        input.specVersion,
        JSON.stringify(input.spec),
      ],
    )
    const id = row.rows[0]?.id
    if (!id) throw new Error('回放课件落库未返回 id')
    await tx.query(`DELETE FROM widget_validations WHERE widget_id = $1`, [id])
    await insertValidations(tx, id, input.proofs)
  })
}

async function insertValidations(
  tx: PoolClient,
  widgetId: string,
  proofs: { assertion: string; params: Record<string, unknown>; detail: string }[],
): Promise<void> {
  for (const proof of proofs) {
    await tx.query(
      `INSERT INTO widget_validations (widget_id, assertion, status, params, detail)
       VALUES ($1, $2, 'pass', $3::jsonb, $4)`,
      [widgetId, proof.assertion, JSON.stringify(proof.params), proof.detail],
    )
  }
}
