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
}): Promise<CourseRow> {
  const row = await queryOne<CourseRow>(
    `INSERT INTO courses (id, owner_id, title)
     VALUES ($1, $2, $3)
     RETURNING ${COURSE_COLUMNS}`,
    [input.id, input.ownerId, input.title],
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
