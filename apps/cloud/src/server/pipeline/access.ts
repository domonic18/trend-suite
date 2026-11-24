import 'server-only'
import type { SessionUser } from '@trend-suite/contracts'
import { findCourseById } from '@/server/content/repo'
import { forbidden } from '@/server/lib/http'

/**
 * 素材访问权：上传者本人，或（素材仍归属课程时）该课程的属主。
 * 素材独立上传入库后 course_id 可空——归属跟着上传者走，不再强制挂课。
 */
export async function assertAssetAccess(
  user: SessionUser,
  row: { created_by: string | null; course_id: string | null },
): Promise<void> {
  if (user.role !== 'producer') return
  if (row.created_by === user.id) return
  if (row.course_id) {
    const course = await findCourseById(row.course_id)
    if (course?.owner_id === user.id) return
  }
  throw forbidden('素材不属于你')
}
