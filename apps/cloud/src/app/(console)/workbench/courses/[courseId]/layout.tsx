'use client'

import { useParams } from 'next/navigation'
import type { ReactNode } from 'react'
import { CourseCenter } from '@/features/content/ui/CourseCenter'

/**
 * 课程中心外壳：一门课的四个阶段收在一页里。
 *
 * 挂在 layout 上 → 在素材/方案/生产之间切换时，
 * 课程栏与阶段轨不卸载，只有内容区在换。
 */
export default function CourseLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ courseId: string }>()
  return <CourseCenter courseId={params.courseId}>{children}</CourseCenter>
}
