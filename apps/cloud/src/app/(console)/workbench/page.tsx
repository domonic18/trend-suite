'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isWorkbenchRole, type SessionUser } from '@trend-suite/contracts'
import { logout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'
import { CourseList } from '@/features/content/ui/CourseList'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'

type State =
  | { phase: 'loading' }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'ready'; user: SessionUser }

export default function WorkbenchPage() {
  const router = useRouter()
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
        setState({ phase: 'ready', user })
      } catch {
        clearToken()
        router.replace('/login')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

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
          <p>生产工作台仅对 producer / operator / admin 开放，学员入口在官网门户。</p>
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
      nav={<span className="on">所有课程</span>}
      crumb="生产工作台 / 所有课程"
    >
      <div className="page-head">
        <div>
          <h1>所有课程</h1>
          <p className="sub">课程恒为草稿；签批与发布由运营执行。</p>
        </div>
      </div>
      <CourseList />
    </WorkbenchShell>
  )
}
