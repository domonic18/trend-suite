'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { SessionUser } from '@trend-suite/contracts'
import { logout as apiLogout, me } from '@/features/accounts/api'
import { clearToken, getToken } from '@/features/accounts/session'

/**
 * 会话状态：整个控制台共用一份。
 *
 * 之前每个页面各自内联一份鉴权守卫（读 sessionStorage → 打 /v1/auth/me → 判角色），
 * 页面切换时守卫重跑，loading 分支又只渲染一行「正在校验登录状态…」，
 * 于是整页闪一下。现在守卫收敛到 (console) layout 的 Provider 里，
 * 路由切换时 Provider 不卸载 → 不再闪。
 *
 * 令牌仍只存 sessionStorage（教师端需求 §4.1/§5：不落 Cookie），
 * 因此这份状态是纯客户端的——服务端渲染期拿不到令牌。
 */

export type SessionStatus = 'loading' | 'anonymous' | 'ready'

export type SessionState = {
  status: SessionStatus
  user: SessionUser | null
  logout: () => Promise<void>
  /** 令牌变了（重新登录）或需要重取身份时用。 */
  reload: () => void
}

/** 一次会话只打一次 /v1/auth/me：按令牌缓存，换令牌自动失效。 */
let cached: { token: string; promise: Promise<SessionUser> } | null = null

function fetchMe(token: string): Promise<SessionUser> {
  if (cached && cached.token === token) return cached.promise
  const promise = me().catch((err: unknown) => {
    cached = null
    throw err
  })
  cached = { token, promise }
  return promise
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [user, setUser] = useState<SessionUser | null>(null)

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setStatus('anonymous')
      setUser(null)
      return
    }
    try {
      const who = await fetchMe(token)
      setUser(who)
      setStatus('ready')
    } catch {
      // 令牌失效：清掉，回登录页。
      cached = null
      clearToken()
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined)
    cached = null
    clearToken()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const reload = useCallback(() => {
    cached = null
    void load()
  }, [load])

  const value = useMemo<SessionState>(
    () => ({ status, user, logout, reload }),
    [status, user, logout, reload],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用')
  return value
}
