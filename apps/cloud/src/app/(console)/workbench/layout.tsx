'use client'

import type { ReactNode } from 'react'
import { CoursesProvider } from '@/features/content/ui/CoursesProvider'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'

/**
 * 生产工作台外壳：课程栏 + 顶栏 + 内容区。
 *
 * 挂在 layout 上 → 切课、切阶段不再整页卸载重挂，
 * 于是「正在校验登录状态」的闪烁与页面骨架都消失了。
 *
 * 主题（arch/08 §6）：data-wb-theme 挂在 <html> 上——body 的
 * color/background 等根作用域 var() 也要按工作台主题解析（挂在子树
 * 上时继承色仍按 :root 解析，深色下全是浅色主题的深字）。下方 inline
 * 脚本在 HTML 解析时同步设属性防首帧闪白（只在本工作台路由组注入，
 * 离开时由 WorkbenchShell 卸载清理，门户/登录不受影响）。
 */
const THEME_BOOTSTRAP = `(() => {
  try {
    const saved = localStorage.getItem('wb.theme');
    document.documentElement.setAttribute('data-wb-theme', saved === 'light' ? 'light' : 'dark');
  } catch { document.documentElement.setAttribute('data-wb-theme', 'dark'); }
})();`

export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <CoursesProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <WorkbenchShell>{children}</WorkbenchShell>
    </CoursesProvider>
  )
}
