import type { SessionUser } from '@trend-suite/contracts'

/** 运营控制台入口角色（arch/07 §9：运营只读模型配置，管理员可写）。 */
export const OPS_ROLES = ['operator', 'admin'] as const

export function isOpsRole(user: Pick<SessionUser, 'role'>): boolean {
  return (OPS_ROLES as readonly string[]).includes(user.role)
}
