import 'server-only'
import type { CourseView, CourseStatus, SessionUser } from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import * as repo from './repo'

function toCourseView(row: repo.CourseRow): CourseView {
  return {
    id: row.id,
    title: row.title,
    status: row.status as CourseStatus,
    ownerId: row.owner_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** 新课程恒为草稿——producer 只写草稿，签批与发布是运营的事（arch/01 端职责边界）。 */
export async function createCourse(ownerId: string, title: string): Promise<CourseView> {
  const row = await repo.insertCourse({ id: newId('course'), ownerId, title })
  return toCourseView(row)
}

/** 教师看自己的课；运营与管理员看全部。 */
export function listCoursesFor(user: SessionUser): Promise<CourseView[]> {
  const rows =
    user.role === 'producer'
      ? repo.listCoursesByOwner(user.id)
      : repo.listAllCourses()
  return rows.then((list) => list.map(toCourseView))
}
