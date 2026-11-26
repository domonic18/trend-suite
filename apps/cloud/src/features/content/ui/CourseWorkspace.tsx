'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { CourseWorkspaceSkeleton } from '@/features/content/ui/OutlineSkeleton'
import { PlanPanel } from '@/features/content/ui/PlanPanel'
import { ProductionStudio } from '@/features/production/ui/ProductionStudio'
import { useSession } from '@/features/accounts/SessionProvider'

/**
 * 课程工作台（Sasan 式合一，arch/08 §1）：课程只有一个 URL——进入即工作台，
 * 按课程阶段原地渲染形态，URL 全程不变：
 * - 方案期（planStatus != approved）：Agent 方案对话 + 大纲工作区；
 *   「确认大纲，开始制作」后本组件经 courses.refresh() 看到 planStatus
 *   变 approved，**原地切换**为制作形态（AgentChat 以 key=phase 重挂，
 *   SSE 线程从 plan 切 production，对话流自然出现「本轮制作开始」分隔）。
 * - 制作期（approved）：制作对话 + 产物工作区。
 *
 * 阶段切换不换页：没有中间跳转、没有二次加载——刷新也只发生在进课一次。
 */
export function CourseWorkspace({
  courseId,
  userName = '教师',
}: {
  courseId: string
  userName?: string
}) {
  const router = useRouter()
  const { courses, loading } = useCourses()
  const session = useSession()
  const course = courses.find((item) => item.id === courseId)

  useEffect(() => {
    if (!loading && !course) router.replace('/workbench')
  }, [loading, course, router])

  // 课程未就绪（列表加载中 / 不存在待跳转）统一骨架——跳转由 effect 兜底
  if (!course) return <CourseWorkspaceSkeleton />

  const title = course.title
  const approved = course.planStatus === 'approved'

  return approved ? (
    <ProductionStudio
      key="production"
      courseId={courseId}
      courseTitle={title}
      userName={userName ?? session.user?.displayName ?? '教师'}
    />
  ) : (
    <PlanPanel
      key="plan"
      courseId={courseId}
      courseTitle={title}
      userName={userName ?? session.user?.displayName ?? '教师'}
    />
  )
}
