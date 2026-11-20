import { isWorkbenchRole, type SessionUser } from '@trend-suite/contracts'
import { isOpsRole } from './ops-role'

/**
 * 控制台分区：登录页不鉴权，运营控制台与教师工作台各按自己的角色口径。
 *
 * 纯函数——(console) layout 与页面都靠它决定「这块屏幕要不要登录、谁能进」。
 */
export type ConsoleArea = 'public' | 'ops' | 'workbench'

export function accessFor(pathname: string): ConsoleArea {
  if (pathname === '/login' || pathname.startsWith('/login/')) return 'public'
  if (pathname === '/ops' || pathname.startsWith('/ops/')) return 'ops'
  return 'workbench'
}

/** 这个角色能不能进这块屏幕。服务端接口另有自己的角色校验，这里只是别让不该看的人看到壳。 */
export function canEnterArea(area: ConsoleArea, role: SessionUser['role']): boolean {
  if (area === 'public') return true
  if (area === 'ops') return isOpsRole({ role })
  return isWorkbenchRole(role)
}
