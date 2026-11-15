import 'server-only'
import type { CourseView, CourseStatus, SessionUser } from '@trend-suite/contracts'
import { forbidden, notFound } from '@/server/lib/http'
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

/**
 * 取一门课并校验可见性：教师只能碰自己的课，运营与管理员不限。
 * 素材、方案、生产等一切挂在课程下的动作都走这里。
 */
export async function getCourseForUser(user: SessionUser, courseId: string): Promise<CourseView> {
  const row = await repo.findCourseById(courseId)
  if (!row) throw notFound('课程不存在')
  if (user.role === 'producer' && row.owner_id !== user.id) {
    throw forbidden('该课程不属于你')
  }
  return toCourseView(row)
}
