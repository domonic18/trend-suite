import 'server-only'
import { query, queryOne } from '@/server/lib/db'

export type CourseRow = {
  id: string
  owner_id: string
  title: string
  status: string
  position: number
  created_at: Date
  updated_at: Date
}

const COURSE_COLUMNS = 'id, owner_id, title, status, position, created_at, updated_at'

export async function insertCourse(input: {
  id: string
  ownerId: string
  title: string
  /** 目录先验（可选）：文本与目录树同源，落已有列（不加列）。 */
  outlineText?: string
  outline?: unknown
}): Promise<CourseRow> {
  const row = await queryOne<CourseRow>(
    `INSERT INTO courses (id, owner_id, title, outline_text, outline)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING ${COURSE_COLUMNS}`,
    [
      input.id,
      input.ownerId,
      input.title,
      input.outlineText ?? null,
      input.outline === undefined ? null : JSON.stringify(input.outline),
    ],
  )
  if (!row) throw new Error('课程写入失败')
  return row
}

export function listCoursesByOwner(ownerId: string): Promise<CourseRow[]> {
  return query<CourseRow>(
    `SELECT ${COURSE_COLUMNS} FROM courses WHERE owner_id = $1 ORDER BY created_at DESC`,
    [ownerId],
  )
}

export function listAllCourses(): Promise<CourseRow[]> {
  return query<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses ORDER BY created_at DESC`)
}

export function findCourseById(id: string): Promise<CourseRow | null> {
  return queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = $1`, [id])
}

/** 课程摘要行：素材、方案、生产三处的进度合一行（教师端课程卡与侧栏要显示）。 */
export type CourseSummaryRow = {
  id: string
  owner_id: string
  title: string
  status: string
  created_at: Date
  updated_at: Date
  asset_count: number
  ready_asset_count: number
  plan_status: string | null
  plan_version: number | null
  plan_skeleton: unknown
  section_count: number
  done_section_count: number
}

/**
 * 课程摘要：一条 SQL 把素材数、当前方案、生产进度取齐。
 *
 * 用标量子查询而不是 join 聚合——join 三张表再 group by 会在素材多的课程上
 * 把行数放大三个量级；课程列表是每个页面都要打的接口。
 *
 * 当前方案 = 状态为 draft 或 approved 的最新版本（superseded/rejected 是历史）。
 */
export function listCourseSummaries(ownerId: string | null): Promise<CourseSummaryRow[]> {
  return query<CourseSummaryRow>(
    `SELECT c.id, c.owner_id, c.title, c.status, c.created_at, c.updated_at,
            (SELECT count(*)::int FROM media_assets m
              WHERE m.course_id = c.id) AS asset_count,
            (SELECT count(*)::int FROM media_assets m
              WHERE m.course_id = c.id AND m.status = 'ready') AS ready_asset_count,
            p.status AS plan_status,
            p.version AS plan_version,
            p.skeleton AS plan_skeleton,
            (SELECT count(*)::int FROM sections s
              WHERE s.course_id = c.id) AS section_count,
            (SELECT count(*)::int FROM sections s
              WHERE s.course_id = c.id AND s.status = 'complete') AS done_section_count
       FROM courses c
       LEFT JOIN LATERAL (
         SELECT status, version, skeleton FROM course_plans cp
          WHERE cp.course_id = c.id AND cp.status IN ('draft', 'approved')
          ORDER BY cp.version DESC
          LIMIT 1
       ) p ON TRUE
      WHERE ($1::text IS NULL OR c.owner_id = $1)
      ORDER BY c.created_at DESC`,
    [ownerId],
  )
}
