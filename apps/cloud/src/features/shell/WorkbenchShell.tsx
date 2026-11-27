'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useSession } from '@/features/accounts/SessionProvider'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { CourseSwitcher } from '@/features/content/ui/CourseSwitcher'
import { phaseOfPath, PHASE_LABELS } from '@/features/content/ui/coursePhase'
import { BuildInfo } from './BuildInfo'
import { ThemeIconButton, UserMenu, useWorkbenchTheme } from './ThemeToggle'

/**
 * 工作台外壳：左侧导航 + 顶栏 + 内容区。
 *
 * 以前顶栏画在每个页面里，切一次路由整页卸载重挂 →
 * 「正在校验登录状态」闪一下。现在顶栏与身份收在这个壳里，
 * 壳挂在 (console)/workbench 的 layout 上，路由切换不卸载。
 */

/** 从路由取当前课程 ID。 */
export function courseIdOfPath(pathname: string): string | null {
  const hit = pathname.match(/^\/workbench\/courses\/([^/]+)/)
  return hit?.[1] ?? null
}

/** 侧栏导航图标（与原型 family 图标同形，24 线性风格）。 */
function NavIcon({ d, children }: { d?: string; children?: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {d ? <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" /> : children}
    </svg>
  )
}

export function WorkbenchShell(props: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useSession()
  const { courses } = useCourses()
  const { theme, toggle } = useWorkbenchTheme()

  const courseId = courseIdOfPath(pathname)
  const onLibrary = pathname.startsWith('/workbench/library')
  const current = courses.find((c) => c.id === courseId) ?? null
  const phase = courseId
    ? (phaseOfPath(pathname) ?? (current ? (current.planStatus === 'approved' ? 'production' : 'plan') : null))
    : null
  const user = session.user
  const name = user?.displayName ?? user?.username ?? ''
  // chat-center 语义进组件树（arch/08 §6）：方案页与制作台对话流是页面主轴，
  // 外壳收起顶栏与主区内边距——不再用 CSS :has() 从内容反穿外壳。
  const chatCenter = /^\/workbench\/courses\/[^/]+$/.test(pathname)

  return (
    <div className={chatCenter ? 'ops-app chat-center' : 'ops-app'}>
      <aside className="ops-sb">
        <div className="ops-brand">
          <span className="mk">趋</span>
          <span>
            <b>趋势课程</b>
            <small>生产工作台</small>
          </span>
        </div>
        <nav className="ops-menu">
          <div className="ops-g">工作台</div>
          <Link className={`ops-i ${courseId || onLibrary ? '' : 'on'}`} href="/workbench">
            <NavIcon d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5zM20 17H6.5A2.5 2.5 0 0 0 4 19.5" />
            我的课程
          </Link>
          <Link className={`ops-i ${onLibrary ? 'on' : ''}`} href="/workbench/library">
            <NavIcon>
              <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M3 9h18M3 15h18M8 4v16M16 4v16" stroke="currentColor" strokeWidth="1.2" />
            </NavIcon>
            素材库
          </Link>
          {current ? (
            <>
              <div className="ops-g">当前课程</div>
              <CourseSwitcher current={current} />
            </>
          ) : null}
        </nav>
        <BuildInfo />
      </aside>

      <div className="wb-col">
        <header className="ops-top">
          {/* 面包屑（对齐 Sasan：可点击链接 + skew 分隔线 + 当前页 aria-current） */}
          <nav className="ops-crumb" aria-label="面包屑">
            <Link href="/workbench">生产工作台</Link>
            {current ? (
              <>
                <i className="sep" aria-hidden="true" />
                <Link
                  className="course-crumb"
                  title={current.title}
                  href={`/workbench/courses/${current.id}`}
                >
                  {current.title}
                </Link>
                {phase ? (
                  <>
                    <i className="sep" aria-hidden="true" />
                    <span aria-current="page">{PHASE_LABELS[phase]}</span>
                  </>
                ) : null}
              </>
            ) : onLibrary ? (
              <>
                <i className="sep" aria-hidden="true" />
                <span aria-current="page">素材库</span>
              </>
            ) : (
              <>
                <i className="sep" aria-hidden="true" />
                <span aria-current="page">所有课程</span>
              </>
            )}
          </nav>
          {/* header 右侧控件（行业惯例）：主题切换 + 用户菜单，两形态页面同位 */}
          <div className="ops-corner">
            <ThemeIconButton theme={theme} onToggle={toggle} />
            <UserMenu
              name={name}
              role={user?.role ?? ''}
              onLogout={() => {
                void session.logout().then(() => router.replace('/login'))
              }}
            />
          </div>
        </header>
        <main className="ops-main">{props.children}</main>
      </div>
    </div>
  )
}
