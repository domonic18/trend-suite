'use client'

import { useParams } from 'next/navigation'
import { CourseWorkspace } from '@/features/content/ui/CourseWorkspace'

/**
 * 课程根 = 工作台（Sasan 式合一）：进入课程即 Agent 对话工作流，按课程
 * 阶段原地渲染方案态 / 制作态，URL 全程不变（arch/08 §1）。
 */
export default function CoursePage() {
  const params = useParams<{ courseId: string }>()
  return <CourseWorkspace courseId={params.courseId} />
}
