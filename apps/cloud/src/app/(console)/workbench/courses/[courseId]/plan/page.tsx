'use client'

import { useParams } from 'next/navigation'
import { useSession } from '@/features/accounts/SessionProvider'
import { PlanPanel } from '@/features/content/ui/PlanPanel'
import { useCourses } from '@/features/content/ui/CoursesProvider'

/** 方案阶段：目标与目录 → Agent 起草 → 审阅批准。 */
export default function CoursePlanPage() {
  const params = useParams<{ courseId: string }>()
  const session = useSession()
  const { courses } = useCourses()
  const course = courses.find((item) => item.id === params.courseId)
  const materials =
    course && course.assetCount > 0
      ? { ready: course.readyAssetCount, total: course.assetCount }
      : null

  return (
    <PlanPanel
      courseId={params.courseId}
      materials={materials}
      userName={session.user?.displayName ?? session.user?.username ?? '教师'}
      courseTitle={course?.title ?? null}
    />
  )
}
