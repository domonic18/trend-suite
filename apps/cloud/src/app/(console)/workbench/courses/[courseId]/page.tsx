'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { OutlineSkeleton } from '@/features/content/ui/OutlineSkeleton'
import { Skeleton } from '@/components/ui/skeleton'

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

  return (
    <div className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
      {/* 中栏：Agent 对话流骨架 */}
      <div className="grid content-start gap-4 rounded-xl border border-line bg-bg p-4">
        <Skeleton className="h-[14px] w-[30%]" />
        {[80, 65, 92].map((w, i) => (
          <div className="flex items-start gap-2.5" key={i}>
            <Skeleton className="size-7 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-[13px]" style={{ width: `${w}%` }} />
              <Skeleton className="h-[13px]" style={{ width: `${Math.max(30, w - 25)}%` }} />
            </div>
          </div>
        ))}
        <div className="flex justify-end">
          <Skeleton className="h-[13px] w-[46%]" />
        </div>
      </div>
      {/* 右栏：产物工作区骨架（页签条 + 大纲） */}
      <div className="grid content-start gap-3.5 rounded-xl border border-line bg-bg p-4">
        <div className="flex gap-3 border-b border-line pb-2.5">
          {['大纲', '课件', '配图'].map((label) => (
            <Skeleton className="h-[13px] w-10" key={label} />
          ))}
        </div>
        <OutlineSkeleton />
      </div>
    </div>
  )
}
