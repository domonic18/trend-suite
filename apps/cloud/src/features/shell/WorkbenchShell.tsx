'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useSession } from '@/features/accounts/SessionProvider'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { CourseSwitcher } from '@/features/content/ui/CourseSwitcher'
import { phaseOfPath, PHASE_LABELS } from '@/features/content/ui/coursePhase'
import { BuildInfo } from './BuildInfo'

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

  const courseId = courseIdOfPath(pathname)
  const onLibrary = pathname.startsWith('/workbench/library')
  const current = courses.find((c) => c.id === courseId) ?? null
  const phase = courseId ? phaseOfPath(pathname) : null
  const user = session.user
  const name = user?.displayName ?? user?.username ?? ''

  return (
    <div className="ops-app">
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
              <Link
                className={`ops-i ${phase === 'plan' ? 'on' : ''}`}
                href={`/workbench/courses/${current.id}/plan`}
              >
                <NavIcon d="M6 3h7l5 5v13H6zM13 3v5h5M9 13h6M9 17h4" />
                课程大纲
              </Link>
              <Link
                className={`ops-i ${phase === 'production' ? 'on' : ''}`}
                href={`/workbench/courses/${current.id}/production`}
              >
                <NavIcon>
                  <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" />
                </NavIcon>
                课件制作
              </Link>
            </>
          ) : null}
        </nav>
        <div className="ops-user">
          <span className="ava">{name.slice(0, 1)}</span>
          <span>
            <span className="un">{name}</span>
            <br />
            <span className="ur">{user?.role ?? ''}</span>
          </span>
          <button
            type="button"
            className="out"
            onClick={() => {
              void session.logout().then(() => router.replace('/login'))
            }}
          >
            退出
          </button>
        </div>
      </aside>

      <div className="wb-col">
        <header className="ops-top">
          <span>生产工作台</span>
          {current ? (
            <>
              <span className="sep">/</span>
              <b>{current.title}</b>
              {phase ? (
                <>
                  <span className="sep">/</span>
                  <span>{PHASE_LABELS[phase]}</span>
                </>
              ) : null}
            </>
          ) : onLibrary ? (
            <>
              <span className="sep">/</span>
              <b>素材库</b>
            </>
          ) : (
            <>
              <span className="sep">/</span>
              <b>所有课程</b>
            </>
          )}
        </header>
        <main className="ops-main">
          {props.children}
          <BuildInfo />
        </main>
      </div>
    </div>
  )
}
