'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { isWorkbenchRole, type SessionUser } from '@trend-suite/contracts'
import { logout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'
import { listCourses } from '@/features/content/api'
import { listAssets } from '@/features/pipeline/api'
import { PlanPanel } from '@/features/content/ui/PlanPanel'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'

type MaterialsReady = { ready: number; total: number }

type State =
  | { phase: 'loading' }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'ready'; user: SessionUser; courseTitle: string; materials: MaterialsReady | null }

export default function CoursePlanPage() {
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
        // 素材就绪计数只作引导展示，取不到不阻塞页面（服务端 T7 门禁仍是权威）。
        let materials: MaterialsReady | null = null
        try {
          const items = await listAssets(courseId)
          if (cancelled) return
          materials = {
            ready: items.filter((item) => item.status === 'ready').length,
            total: items.length,
          }
        } catch {
          materials = null
        }
        setState({ phase: 'ready', user, courseTitle: course?.title ?? '课程', materials })
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
          <Link href="/workbench">所有课程</Link> / {state.courseTitle} / 制作方案
        </>
      }
    >
      <div className="page-head">
        <div>
          <h1>制作方案</h1>
          <p className="sub">提交课程目标（人工目录可留空，由 Agent 代拟），Agent 起草课程骨架、概念图谱、术语表与分节计划；审阅后批准 / 微调 / 打回。</p>
        </div>
      </div>
      <div className="stage-tabs">
        <Link href={`/workbench/courses/${courseId}`}>上传与转写</Link>
        <Link href={`/workbench/courses/${courseId}/plan`} className="on">
          制作方案
        </Link>
        <Link href={`/workbench/courses/${courseId}/production`}>九步生产</Link>
      </div>
      <PlanPanel
        courseId={courseId}
        materials={state.materials}
        userName={state.user.displayName ?? state.user.username}
      />
    </WorkbenchShell>
  )
}
