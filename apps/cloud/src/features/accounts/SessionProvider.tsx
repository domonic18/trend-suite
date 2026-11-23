'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { SessionUser } from '@trend-suite/contracts'
import { logout as apiLogout, me } from '@/features/accounts/api'
import { clearToken, getToken, subscribeToken } from '@/features/accounts/session'

/**
 * 会话状态：整个控制台共用一份。
 *
 * 之前每个页面各自内联一份鉴权守卫（读 sessionStorage → 打 /v1/auth/me → 判角色），
 * 页面切换时守卫重跑，loading 分支又只渲染一行「正在校验登录状态…」，
 * 于是整页闪一下。现在守卫收敛到 (console) layout 的 Provider 里，
 * 路由切换时 Provider 不卸载 → 不再闪。
 *
 * 身份是令牌的派生状态：令牌的任何变化（登录写入、登出、401 清除）经
 * subscribeToken 到达这里，自动重新校验一次 /v1/auth/me。
 * 不变量：status === 'anonymous' 当且仅当存储里已无令牌——
 * 手里有令牌时永远呈现 loading/ready，闸门不会把已登录的人弹回登录页。
 *
 * 令牌仍只存 sessionStorage（教师端需求 §4.1/§5：不落 Cookie），
 * 因此这份状态是纯客户端的——服务端渲染期拿不到令牌。
 */

export type SessionStatus = 'loading' | 'anonymous' | 'ready'

export type SessionState = {
  status: SessionStatus
  user: SessionUser | null
  logout: () => Promise<void>
}

/** 同一令牌只打一次 /v1/auth/me；令牌换了缓存自动失效。 */
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
  // 在途竞态守卫：只有最新一次 load 允许写状态——
  // 旧的 me() 迟到（如 401）不得覆盖新令牌的校验结果。
  const epoch = useRef(0)

  const load = useCallback(async () => {
    const generation = ++epoch.current
    const token = getToken()
    if (!token) {
      setUser(null)
      setStatus('anonymous')
      return
    }
    setStatus('loading')
    try {
      const who = await fetchMe(token)
      if (generation !== epoch.current) return
      setUser(who)
      setStatus('ready')
    } catch {
      if (generation !== epoch.current) return
      // 令牌失效：清掉（变更发布后 load 再跑一次，落到 anonymous），回登录页。
      clearToken()
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    void load()
    return subscribeToken(() => void load())
  }, [load])

  const logout = useCallback(async () => {
    await apiLogout().catch(() => undefined)
    // 清令牌即发布变更：load() 自己落到 anonymous，闸门随后回登录页。
    clearToken()
  }, [])

  const value = useMemo<SessionState>(() => ({ status, user, logout }), [status, user, logout])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用')
  return value
}
