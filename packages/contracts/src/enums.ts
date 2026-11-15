import { z } from 'zod'

/** 角色与状态枚举（arch/03 §2.1）：跨端引用同一份，避免各端各写一套字面量。 */
export const userRoles = ['student', 'producer', 'operator', 'admin'] as const
export const userRole = z.enum(userRoles)

export const userStatuses = ['active', 'disabled'] as const
export const userStatus = z.enum(userStatuses)

export const courseStatuses = ['draft', 'published'] as const
export const courseStatus = z.enum(courseStatuses)

export const mediaAssetStatuses = [
  'awaiting_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
] as const
export const mediaAssetStatus = z.enum(mediaAssetStatuses)

/** 生产工作台入口角色：学员不可见（教师端需求 T1）。 */
export const workbenchRoles = ['producer', 'operator', 'admin'] as const
export const workbenchRole = z.enum(workbenchRoles)

export function isWorkbenchRole(role: (typeof userRoles)[number]): boolean {
  return (workbenchRoles as readonly string[]).includes(role)
}

export type UserRole = z.infer<typeof userRole>
export type UserStatus = z.infer<typeof userStatus>
export type CourseStatus = z.infer<typeof courseStatus>
export type MediaAssetStatus = z.infer<typeof mediaAssetStatus>
export type WorkbenchRole = z.infer<typeof workbenchRole>
