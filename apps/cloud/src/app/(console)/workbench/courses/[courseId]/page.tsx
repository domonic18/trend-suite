'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { isWorkbenchRole, type SessionUser } from '@trend-suite/contracts'
import { logout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'
import { listCourses } from '@/features/content/api'
import { MaterialPanel } from '@/features/pipeline/ui/MaterialPanel'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'

type State =
  | { phase: 'loading' }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'ready'; user: SessionUser; courseTitle: string }

export default function CourseMaterialPage() {
  const router = useRouter()
  const params = useParams<{ courseId: string }>()
  const courseId = params.courseId
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const user = await me()
        if (cancelled) return
        if (!isWorkbenchRole(user.role)) {
          setState({ phase: 'denied', user })
          return
        }
        const course = (await listCourses()).find((c) => c.id === courseId)
        if (cancelled) return
        setState({
          phase: 'ready',
          user,
          courseTitle: course?.title ?? '课程',
        })
      } catch {
        clearToken()
        router.replace('/login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [courseId, router])

  const onLogout = useCallback(async () => {
    await logout().catch(() => undefined)
    router.replace('/login')
  }, [router])

  if (state.phase === 'loading') {
    return <main className="wrap">正在校验登录状态…</main>
  }

  if (state.phase === 'denied') {
    return (
      <main className="wrap">
        <div className="empty">
          <p>
            账号 <b>{state.user.username}</b>（{state.user.role}）不能进入生产工作台。
          </p>
          <button type="button" className="btn" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </main>
    )
  }

  return (
    <WorkbenchShell
      user={state.user}
      onLogout={onLogout}
      nav={
        <>
          <Link href="/workbench" className="on">
            所有课程
          </Link>
        </>
      }
      crumb={
        <>
          <Link href="/workbench">所有课程</Link> / {state.courseTitle} / 原始数据
        </>
      }
    >
      <div className="page-head">
        <div>
          <h1>原始数据</h1>
          <p className="sub">把课程录像拖进来，作为这门课的原始素材。</p>
        </div>
      </div>
      <div className="stage-tabs">
        <Link href={`/workbench/courses/${courseId}`} className="on">
          上传与转写
        </Link>
        <Link href={`/workbench/courses/${courseId}/plan`}>课程大纲</Link>
        <Link href={`/workbench/courses/${courseId}/production`}>九步生产</Link>
      </div>
      <MaterialPanel courseId={courseId} />
    </WorkbenchShell>
  )
}
