'use client'

import { Button } from '@/components/ui/button'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { SessionUser } from '@trend-suite/contracts'
import { useSession } from '@/features/accounts/SessionProvider'
import { getToken } from '@/features/accounts/session'
import { accessFor, canEnterArea } from './access'
import { OpsSkeleton, WorkbenchSkeleton } from './ConsoleSkeleton'

/**
 * 控制台闸门（迭代 9）：登录与角色在这里收口。
 *
 * 以前每个页面各写一份守卫，页面切换时守卫重跑 → 整页闪「正在校验登录状态…」。
 * 现在守卫挂在 (console) layout 上，路由切换不卸载 → 只在首次进入时校验一次，
 * 校验期间壳还在、内容区是骨架。
 *
 * 闸门只管「能不能进」；顶栏与侧栏由各区自己的外壳画
 * （工作台 WorkbenchShell、运营控制台 OpsShell），避免双层壳。
 */

function Denied(props: { user: SessionUser; area: 'ops' | 'workbench'; onLogout: () => void }) {
  return (
    <main className="wrap">
      <div className="empty">
        <p>
          账号 <b>{props.user.username}</b>（{props.user.role}）不能进入
          {props.area === 'ops' ? '运营控制台' : '生产工作台'}。
        </p>
        <p>
          {props.area === 'ops'
            ? '运营控制台仅对 operator / admin 开放。'
            : '生产工作台仅对 producer / operator / admin 开放，学员入口在官网门户。'}
        </p>
        <Button variant="outline" size="sm" onClick={props.onLogout}>
          退出登录
        </Button>
      </div>
    </main>
  )
}

export function ConsoleGate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useSession()
  const area = accessFor(pathname)

  const anonymous = area !== 'public' && session.status === 'anonymous'
  useEffect(() => {
    if (anonymous) router.replace('/login')
  }, [anonymous, router])

  if (area === 'public') return <>{children}</>

  // 乐观会话（行业惯例：token 在手即先画壳，me 校验并行不阻塞渲染）：
  // workbench 区在 loading 且有 token 时直接放行——壳（WorkbenchShell 的
  // user 用法空安全）与课程列表 fetch（Provider 挂载即发）与 /auth/me
  // 三方并行，省掉「骨架等 me → 再等列表」的串行 RTT；me 判失败时
  // status 转 anonymous，下面的跳转逻辑兜底回登录页。
  const optimistic = area === 'workbench' && session.status === 'loading' && typeof window !== 'undefined' && !!getToken()
  if (optimistic) return <>{children}</>

  if (session.status === 'loading') {
    return area === 'ops' ? <OpsSkeleton /> : <WorkbenchSkeleton />
  }

  if (session.status === 'anonymous') {
    // 跳登录页的那一帧不画内容——避免闪出无壳的内容页。
    return area === 'ops' ? <OpsSkeleton /> : <WorkbenchSkeleton rows={1} />
  }

  const user = session.user
  if (!user) return area === 'ops' ? <OpsSkeleton /> : <WorkbenchSkeleton rows={1} />
  if (!canEnterArea(area, user.role)) {
    return (
      <Denied
        user={user}
        area={area}
        onLogout={() => {
          void session.logout().then(() => router.replace('/login'))
        }}
      />
    )
  }

  return <>{children}</>
}
