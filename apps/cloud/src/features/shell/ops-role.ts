import { canWriteOps, opsReadRoles, type SessionUser } from '@trend-suite/contracts'

/** 运营台准入（单一真想在 contracts：opsReadRoles / opsWriteRoles）。 */
export const OPS_ROLES = opsReadRoles

export function isOpsRole(user: Pick<SessionUser, 'role'>): boolean {
  return (OPS_ROLES as readonly string[]).includes(user.role)
}

export const canWriteOpsConfig = canWriteOps
