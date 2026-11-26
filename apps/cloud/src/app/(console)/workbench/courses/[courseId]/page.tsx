'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { CourseWorkspaceSkeleton } from '@/features/content/ui/OutlineSkeleton'

/**
 * 课程根路径不再单独成页：进入课程即 Agent 对话工作流。
 * 方案没批准 → 方案页；已批准 → 制作台。等待跳转的一瞬显示目标页形态的
 * 骨架（中栏对话流 + 右栏大纲），不再闪「进入课程…」文字页。
 */
export default function CourseEntryPage() {
  const params = useParams<{ courseId: string }>()
  const router = useRouter()
  const { courses, loading } = useCourses()
  const course = courses.find((item) => item.id === params.courseId)

  useEffect(() => {
    if (loading) return
    if (!course) {
      router.replace('/workbench')
      return
    }
    router.replace(
      course.planStatus === 'approved'
        ? `/workbench/courses/${course.id}/production`
        : `/workbench/courses/${course.id}/plan`,
    )
  }, [loading, course, router])

  return <CourseWorkspaceSkeleton />
}
