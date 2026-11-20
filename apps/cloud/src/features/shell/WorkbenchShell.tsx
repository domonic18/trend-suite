'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useSession } from '@/features/accounts/SessionProvider'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { phaseOfPath, PHASE_LABELS } from '@/features/content/ui/coursePhase'
import { courseStatusTagOf } from '@/features/content/ui/coursePhase'
import { BuildInfo } from './BuildInfo'

/**
 * 工作台外壳：左侧课程栏 + 顶栏 + 内容区。
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

export function WorkbenchShell(props: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useSession()
  const { courses } = useCourses()

  const courseId = courseIdOfPath(pathname)
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
          <div className="ops-g">课程</div>
          <Link className={`ops-i ${courseId ? '' : 'on'}`} href="/workbench">
            所有课程
          </Link>
          {courses.map((course) => (
            <Link
              className={`ops-i course ${course.id === courseId ? 'on' : ''}`}
              href={`/workbench/courses/${course.id}`}
              key={course.id}
            >
              <span className="wb-course-name">{course.title}</span>
              <span className="wb-course-meta">{courseStatusTagOf(course).text}</span>
            </Link>
          ))}
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
