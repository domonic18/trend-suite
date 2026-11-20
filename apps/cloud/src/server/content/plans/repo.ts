import 'server-only'
import type { PoolClient } from 'pg'
import type { PlanCheckIssueView } from '@trend-suite/contracts'
import { query, queryOne, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'

/**
 * 课程方案数据访问（arch/05 §5 阶段三 + arch/03 §2.2）。
 * course_plans 是版本轨迹表：草案/批准/微调/打回都产生新版本行。
 */

export type CoursePlanRow = {
  id: string
  course_id: string
  version: number
  status: 'draft' | 'approved' | 'superseded' | 'rejected'
  origin: 'initial' | 'revision' | 'tweak'
  parent_plan_id: string | null
  trigger_note: string | null
  skeleton: unknown
  concept_map: unknown
  glossary: unknown
  section_plan: unknown
  violations: unknown
  ai_run_id: string | null
  created_by: string
  created_at: Date
  updated_at: Date
}

export type ConceptRow = {
  id: string
  course_id: string
  name: string
  aliases: string[]
  definition: string | null
  created_at: Date
}

export type ConceptEdgeRow = {
  id: string
  from_concept: string
  to_concept: string
  kind: 'prerequisite' | 'related'
}

export type PlanContent = {
  skeleton: unknown
  conceptMap: unknown
  glossary: unknown
  sectionPlan: unknown
  violations: unknown
}

const PLAN_COLUMNS = [
  'id',
  'course_id',
  'version',
  'status',
  'origin',
  'parent_plan_id',
  'trigger_note',
  'skeleton',
  'concept_map',
  'glossary',
  'section_plan',
  'violations',
  'ai_run_id',
  'created_by',
  'created_at',
  'updated_at',
].join(', ')

export function findDraftPlan(courseId: string): Promise<CoursePlanRow | null> {
  return queryOne<CoursePlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM course_plans
     WHERE course_id = $1 AND status = 'draft'
     ORDER BY created_at DESC LIMIT 1`,
    [courseId],
  )
}

export function findApprovedPlan(courseId: string): Promise<CoursePlanRow | null> {
  return queryOne<CoursePlanRow>(
    `SELECT ${PLAN_COLUMNS} FROM course_plans
     WHERE course_id = $1 AND status = 'approved'
     ORDER BY created_at DESC LIMIT 1`,
    [courseId],
  )
}

export function findPlanById(id: string): Promise<CoursePlanRow | null> {
  return queryOne<CoursePlanRow>(`SELECT ${PLAN_COLUMNS} FROM course_plans WHERE id = $1`, [id])
}

export function nextPlanVersion(courseId: string): Promise<number> {
  return queryOne<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM course_plans WHERE course_id = $1`,
    [courseId],
  ).then((row) => row?.version ?? 1)
}

export async function insertPlan(
  input: {
    id: string
    courseId: string
    version: number
    status: CoursePlanRow['status']
    origin: CoursePlanRow['origin']
    parentPlanId?: string | null
    triggerNote?: string | null
    createdBy: string
    aiRunId?: string | null
  } & PlanContent,
  tx?: PoolClient,
): Promise<CoursePlanRow> {
  const sql = `INSERT INTO course_plans
    (id, course_id, version, status, origin, parent_plan_id, trigger_note,
     skeleton, concept_map, glossary, section_plan, violations, ai_run_id, created_by)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
   RETURNING ${PLAN_COLUMNS}`
  const params = [
    input.id,
    input.courseId,
    input.version,
    input.status,
    input.origin,
    input.parentPlanId ?? null,
    input.triggerNote ?? null,
    JSON.stringify(input.skeleton),
    JSON.stringify(input.conceptMap),
    JSON.stringify(input.glossary),
    JSON.stringify(input.sectionPlan),
    JSON.stringify(input.violations),
    input.aiRunId ?? null,
    input.createdBy,
  ]
  const run = async (client: PoolClient) => {
    const result = await client.query<CoursePlanRow>(sql, params)
    return result.rows[0]!
  }
  return tx ? run(tx) : withTransaction(run)
}

/** 起草产物回写草案行（reject 占位行由 worker 覆盖成正式内容）。 */
export async function updatePlanContent(
  id: string,
  content: PlanContent & { aiRunId: string | null },
): Promise<void> {
  await query(
    `UPDATE course_plans
     SET skeleton = $2, concept_map = $3, glossary = $4, section_plan = $5,
         violations = $6, ai_run_id = $7, updated_at = now()
     WHERE id = $1`,
    [
      id,
      JSON.stringify(content.skeleton),
      JSON.stringify(content.conceptMap),
      JSON.stringify(content.glossary),
      JSON.stringify(content.sectionPlan),
      JSON.stringify(content.violations),
      content.aiRunId,
    ],
  )
}

export async function updatePlanStatus(
  id: string,
  status: CoursePlanRow['status'],
  tx?: PoolClient,
): Promise<void> {
  const sql = `UPDATE course_plans SET status = $2, updated_at = now() WHERE id = $1`
  if (tx) await tx.query(sql, [id, status])
  else await query(sql, [id, status])
}

// ---------------------------------------------------------------- 课程目标与目录

export type CoursePlanInputRow = {
  goal: string | null
  outline_text: string | null
  outline: unknown
  /** 规划模式：smart（智能规划）/ follow_manual（沿用人工目录骨架）。 */
  plan_mode: string | null
  /** 本次参与规划的素材 id；null = 课程全部素材。 */
  plan_asset_ids: string[] | null
  updated_at: Date
}

export function findCoursePlanInput(courseId: string): Promise<CoursePlanInputRow | null> {
  return queryOne<CoursePlanInputRow>(
    `SELECT goal, outline_text, outline, plan_mode, plan_asset_ids, updated_at FROM courses WHERE id = $1`,
    [courseId],
  )
}

export async function updateCoursePlanInput(
  courseId: string,
  input: { goal: string; outlineText: string; outline: unknown },
): Promise<void> {
  await query(
    `UPDATE courses SET goal = $2, outline_text = $3, outline = $4, updated_at = now() WHERE id = $1`,
    [courseId, input.goal, input.outlineText, JSON.stringify(input.outline)],
  )
}

/**
 * 规划模式与参与素材：与目标/目录分开存。
 * 智能规划要重排目录，但不一定要改人工目录——两件事分开，教师原文才留得住。
 */
export async function updatePlanSelection(
  courseId: string,
  input: { planMode: string; planAssetIds: string[] | null },
): Promise<void> {
  await query(
    `UPDATE courses SET plan_mode = $2, plan_asset_ids = $3, updated_at = now() WHERE id = $1`,
    [courseId, input.planMode, input.planAssetIds],
  )
}

export async function updateCourseOutline(courseId: string, outline: unknown): Promise<void> {
  await query(`UPDATE courses SET outline = $2, updated_at = now() WHERE id = $1`, [
    courseId,
    JSON.stringify(outline),
  ])
}

/**
 * 目录文本与目录树同源：微调后同步回写文本，
 * 否则「教师原文优先」的解析会读到微调前的旧文本，把微调丢掉。
 */
export async function updateCourseOutlineText(courseId: string, text: string): Promise<void> {
  await query(`UPDATE courses SET outline_text = $2, updated_at = now() WHERE id = $1`, [
    courseId,
    text,
  ])
}

// ---------------------------------------------------------------- 概念（批准时才落库）

export async function insertConcepts(
  rows: { id: string; courseId: string; name: string; aliases: string[]; definition: string | null }[],
  tx: PoolClient,
): Promise<void> {
  for (const row of rows) {
    await tx.query(
      `INSERT INTO concepts (id, course_id, name, aliases, definition)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, row.courseId, row.name, row.aliases, row.definition],
    )
  }
}

export async function insertConceptEdges(
  rows: { id: string; courseId: string; fromConcept: string; toConcept: string; kind: string }[],
  tx: PoolClient,
): Promise<void> {
  for (const row of rows) {
    await tx.query(
      `INSERT INTO concept_edges (id, course_id, from_concept, to_concept, kind)
       VALUES ($1, $2, $3, $4, $5)`,
      [row.id, row.courseId, row.fromConcept, row.toConcept, row.kind],
    )
  }
}

export async function updateConceptAliases(
  courseId: string,
  conceptId: string,
  aliases: string[],
): Promise<void> {
  await query(
    `UPDATE concepts SET aliases = $3 WHERE course_id = $1 AND id = $2`,
    [courseId, conceptId, aliases],
  )
}

export function listConceptRows(courseId: string): Promise<ConceptRow[]> {
  return query<ConceptRow>(
    `SELECT id, course_id, name, aliases, definition, created_at
     FROM concepts WHERE course_id = $1 ORDER BY created_at ASC`,
    [courseId],
  )
}

export function listConceptEdgeRows(courseId: string): Promise<ConceptEdgeRow[]> {
  return query<ConceptEdgeRow>(
    `SELECT id, from_concept, to_concept, kind
     FROM concept_edges WHERE course_id = $1 ORDER BY created_at ASC`,
    [courseId],
  )
}

// ---------------------------------------------------------------- 起草语料：就绪素材的转写文本

export type TranscriptLineRow = {
  asset_id: string
  original_name: string | null
  start_ms: number
  text: string
}

export function listTranscriptLines(courseId: string): Promise<TranscriptLineRow[]> {
  return query<TranscriptLineRow>(
    `SELECT m.id AS asset_id, m.original_name, s.start_ms, s.text
     FROM media_assets m
     JOIN transcript_segments s ON s.asset_id = m.id
     WHERE m.course_id = $1 AND m.status = 'ready'
     ORDER BY m.created_at ASC, s.seq ASC`,
    [courseId],
  )
}

// ---------------------------------------------------------------- 规划自检记录

export type PlanReviewRow = {
  id: string
  course_id: string
  plan_id: string | null
  status: 'pass' | 'fail' | 'manual'
  attempts: number
  issues: PlanCheckIssueView[]
  created_at: Date
}

/**
 * 落一条自检结论：pass 放行、fail 重规划中、manual 转人工。
 * 自检记录独立于草案行——失败的方案没有草案行，但失败原因要留痕给教师看。
 */
export async function insertReview(input: {
  courseId: string
  planId: string | null
  status: 'pass' | 'fail' | 'manual'
  attempts: number
  issues: PlanCheckIssueView[]
}): Promise<void> {
  await query(
    `INSERT INTO plan_reviews (id, course_id, plan_id, status, attempts, issues)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      newId('planReview'),
      input.courseId,
      input.planId,
      input.status,
      input.attempts,
      JSON.stringify(input.issues),
    ],
  )
}

/** 最近一次自检结论（教师端看「自检通过 / 已转人工」）。 */
export function findLatestReview(courseId: string): Promise<PlanReviewRow | null> {
  return queryOne<PlanReviewRow>(
    `SELECT id, course_id, plan_id, status, attempts, issues, created_at
     FROM plan_reviews WHERE course_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [courseId],
  )
}
