import type { SessionUser } from '@trend-suite/contracts'

/** 运营控制台准入角色（arch/07 §9 演进）：producer 可进（模型配置只读，
 *  教师在工作台需要查看/测试所用模型）；operator 同只读；admin 可写。
 *  写权限分级在各面板内（OpsModelsPanel 的 canWrite）。 */
export const OPS_ROLES = ['producer', 'operator', 'admin'] as const

export function isOpsRole(user: Pick<SessionUser, 'role'>): boolean {
  return (OPS_ROLES as readonly string[]).includes(user.role)
}
