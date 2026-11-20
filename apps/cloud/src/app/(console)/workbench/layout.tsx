'use client'

import type { ReactNode } from 'react'
import { CoursesProvider } from '@/features/content/ui/CoursesProvider'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'

/**
 * 生产工作台外壳：课程栏 + 顶栏 + 内容区。
 *
 * 挂在 layout 上 → 切课、切阶段不再整页卸载重挂，
 * 于是「正在校验登录状态」的闪烁与页面骨架都消失了。
 */
export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <CoursesProvider>
      <WorkbenchShell>{children}</WorkbenchShell>
    </CoursesProvider>
  )
}
