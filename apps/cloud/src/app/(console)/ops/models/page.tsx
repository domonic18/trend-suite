'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@trend-suite/contracts'
import { logout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'
import { OpsModelsPanel } from '@/features/models/ui/OpsModelsPanel'
import { OpsShell } from '@/features/shell/OpsShell'
import { isOpsRole } from '@/features/shell/ops-role'

type State =
  | { phase: 'loading' }
  | { phase: 'denied'; user: SessionUser }
  | { phase: 'ready'; user: SessionUser }

export default function OpsModelsPage() {
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
        if (!isOpsRole(user)) {
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
            账号 <b>{state.user.username}</b>（{state.user.role}）不能进入运营控制台。
          </p>
          <p>运营控制台仅对 operator / admin 开放。</p>
          <button type="button" className="btn" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </main>
    )
  }

  return (
    <OpsShell user={state.user} active="模型配置" onLogout={onLogout}>
      <div className="ops-ph">
        <div>
          <div className="t">模型配置</div>
          <div className="s">
            模型条目统一维护（内容生成 / 视觉理解 / 语音转写 / 向量嵌入），按任务槽位绑定主备；密钥仅在此管理。
          </div>
        </div>
      </div>
      <OpsModelsPanel canWrite={state.user.role === 'admin'} />
    </OpsShell>
  )
}
