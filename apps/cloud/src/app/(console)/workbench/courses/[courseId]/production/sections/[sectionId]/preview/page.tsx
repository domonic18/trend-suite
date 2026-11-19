'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { isWorkbenchRole, type SessionUser } from '@trend-suite/contracts'
import { logout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'
import { listCourses } from '@/features/content/api'
import { WorkbenchShell } from '@/features/shell/WorkbenchShell'
import { SectionPreview } from '@/features/content/ui/SectionPreview'

type State =
  | { phase: 'loading' }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'ready'; user: SessionUser; courseTitle: string }

export default function SectionPreviewPage() {
  const router = useRouter()
  const params = useParams<{ courseId: string; sectionId: string }>()
  const courseId = params.courseId
  const sectionId = params.sectionId
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
        setState({ phase: 'ready', user, courseTitle: course?.title ?? '课程' })
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
          <Link href="/workbench">所有课程</Link> /{' '}
          <Link href={`/workbench/courses/${courseId}/production`}>{state.courseTitle} · 九步生产</Link> / 正文预览
        </>
      }
    >
      <div className="page-head">
        <div>
          <h1>正文预览</h1>
          <p className="sub">事实锚点可回溯到原始素材时间窗；片段可播；三路图示按落库形态渲染。</p>
        </div>
      </div>
      <div className="stage-tabs">
        <Link href={`/workbench/courses/${courseId}`}>上传与转写</Link>
        <Link href={`/workbench/courses/${courseId}/plan`}>制作方案</Link>
        <Link href={`/workbench/courses/${courseId}/production`} className="on">
          九步生产
        </Link>
      </div>
      <SectionPreview courseId={courseId} sectionId={sectionId} />
    </WorkbenchShell>
  )
}
