'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { routes } from '@/lib/routes'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { CourseSwitcher } from '@/features/content/ui/CourseSwitcher'
import { phaseOfPath, PHASE_LABELS } from '@/features/content/ui/coursePhase'
import { ConsoleShell, Crumb, ShellNav } from './ConsoleShell'

/**
 * 工作台外壳：ConsoleShell 的配置（侧栏导航 + 课程切换器 + 运营台入口 + 面包屑）。
 * 顶栏与身份收在壳里，挂在 (console)/workbench 的 layout 上，路由切换不卸载。
 */

/** 从路由取当前课程 ID。 */
export function courseIdOfPath(pathname: string): string | null {
  const hit = pathname.match(/^\/workbench\/courses\/([^/]+)/)
  return hit?.[1] ?? null
}

const ICON_COURSES = (
  <path
    d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5zM20 17H6.5A2.5 2.5 0 0 0 4 19.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  />
)
const ICON_LIBRARY = (
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3 9h18M3 15h18M8 4v16M16 4v16" stroke="currentColor" strokeWidth="1.2" />
  </>
)
const ICON_OPS = (
  <path
    d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.86z"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  />
)

export function WorkbenchShell(props: { children: ReactNode }) {
  const pathname = usePathname()
  const { courses } = useCourses()

  const courseId = courseIdOfPath(pathname)
  const onLibrary = pathname.startsWith(routes.workbench.library)
  const inCourse = courseId !== null
  const current = courses.find((c) => c.id === courseId) ?? null
  const phase = courseId
    ? (phaseOfPath(pathname) ?? (current ? (current.planStatus === 'approved' ? 'production' : 'plan') : null))
    : null
  // 课程工作台：对话流是页面主轴，壳收起主区内外边距通栏全高（arch/08 §6）。
  const chatCenter = /^\/workbench\/courses\/[^/]+$/.test(pathname)

  const crumbItems = current
    ? [
        { label: '生产工作台', href: routes.workbench.index },
        { label: current.title, href: routes.workbench.course(current.id), title: current.title },
        ...(phase ? [{ label: PHASE_LABELS[phase] }] : []),
      ]
    : [
        { label: '生产工作台', href: routes.workbench.index },
        { label: onLibrary ? '素材库' : '所有课程' },
      ]

  return (
    <ConsoleShell
      areaLabel="生产工作台"
      chatCenter={chatCenter}
      nav={
        <ShellNav
          group="工作台"
          items={[
            { key: 'courses', label: '我的课程', href: routes.workbench.index, icon: ICON_COURSES, active: !inCourse && !onLibrary },
            { key: 'library', label: '素材库', href: routes.workbench.library, icon: ICON_LIBRARY, active: onLibrary },
          ]}
        />
      }
      navExtra={
        current ? (
          <>
            <ShellNav group="当前课程" items={[]} />
            <CourseSwitcher current={current} />
          </>
        ) : null
      }
      sidebarExtra={
        <nav className="ops-menu ops-menu--bottom">
          <ShellNav group="运营" items={[{ key: 'ops', label: '运营控制台', href: routes.ops, icon: ICON_OPS }]} />
        </nav>
      }
      crumb={<Crumb items={crumbItems} />}
    >
      {props.children}
    </ConsoleShell>
  )
}
