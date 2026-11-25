'use client'

import { CourseList } from '@/features/content/ui/CourseList'

/** 所有课程：课程卡列表（鉴权与外壳由 layout 与 ConsoleGate 负责）。 */
export default function WorkbenchPage() {
  return <CourseList />
}
