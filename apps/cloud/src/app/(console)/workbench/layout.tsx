import type { ReactNode } from 'react'
import { CoursesProvider } from '@/features/content/ui/CoursesProvider'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'
import { THEME_BOOTSTRAP } from '@/features/shell/themeBootstrap'

/**
 * 生产工作台外壳：课程栏 + 顶栏 + 内容区。
 *
 * 挂在 layout 上 → 切课、切阶段不再整页卸载重挂，
 * 于是「正在校验登录状态」的闪烁与页面骨架都消失了。
 *
 * 主题（arch/08 §6）：data-wb-theme 挂在 <html> 上（根作用域 var() 与继承色
 * 都按工作台主题解析）。防闪白脚本由**服务端组件**渲染进 SSR HTML——
 * 浏览器不执行 innerHTML 注入的脚本（放在 client component 里不会跑），
 * 会先闪一下浅色。离开工作台时 WorkbenchShell 卸载并移除该属性。
 */
export default function WorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      <CoursesProvider>
        <WorkbenchShell>{children}</WorkbenchShell>
      </CoursesProvider>
    </>
  )
}
