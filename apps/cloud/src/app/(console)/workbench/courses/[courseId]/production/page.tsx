'use client'

import { useParams } from 'next/navigation'
import { useSession } from '@/features/accounts/SessionProvider'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { ProductionStudio } from '@/features/production/ui/ProductionStudio'

/** 制作阶段：九步生产 + 制作 Agent 对话（arch/08 chat-center）。 */
export default function CourseProductionPage() {
  const params = useParams<{ courseId: string }>()
  const session = useSession()
  const { courses } = useCourses()
  const course = courses.find((item) => item.id === params.courseId)
  return (
    <ProductionStudio
      courseId={params.courseId}
      courseTitle={course?.title ?? null}
      userName={session.user?.displayName ?? session.user?.username ?? '教师'}
    />
  )
}
