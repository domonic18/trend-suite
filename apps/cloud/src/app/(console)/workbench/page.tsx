'use client'

import { CourseList } from '@/features/content/ui/CourseList'

/** 所有课程：课程卡列表（鉴权与外壳由 layout 与 ConsoleGate 负责）。 */
export default function WorkbenchPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>所有课程</h1>
          <p className="sub">课程恒为草稿；签批与发布由运营执行。</p>
        </div>
      </div>
      <CourseList />
    </>
  )
}
