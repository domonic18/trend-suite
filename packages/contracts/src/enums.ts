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

/** 方案版本状态（arch/05 §5 阶段三）：reject 旧行落 rejected + 另起新 draft。 */
export const planStatuses = ['draft', 'approved', 'superseded', 'rejected'] as const
export const planStatus = z.enum(planStatuses)

/** 方案来源：起草 / 打回重起草 / 结构化微调派生。 */
export const planOrigins = ['initial', 'revision', 'tweak'] as const
export const planOrigin = z.enum(planOrigins)

/** 概念依赖边类型（arch/03 §2.2）：prerequisite 子图无环由应用层校验。 */
export const conceptEdgeKinds = ['prerequisite', 'related'] as const
export const conceptEdgeKind = z.enum(conceptEdgeKinds)

/** 分节证据匹配度结论：低于阈值（0.5）判 low_match，批准前需教师裁决。 */
export const sectionMatchStatuses = ['ok', 'low_match'] as const
export const sectionMatchStatus = z.enum(sectionMatchStatuses)

/** 逐节九步生产任务状态（arch/05 §6）：pending_manual 为回灌超限转人工待办。 */
export const productionTaskStatuses = ['pending', 'running', 'done', 'failed', 'pending_manual'] as const
export const productionTaskStatus = z.enum(productionTaskStatuses)

/** 逐节生产产物节状态：pending（生产中）→ complete（九步全过）；对外只认 complete。 */
export const productionSectionStatuses = ['pending', 'complete'] as const
export const productionSectionStatus = z.enum(productionSectionStatuses)

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
export type ProductionTaskStatus = z.infer<typeof productionTaskStatus>
export type ProductionSectionStatus = z.infer<typeof productionSectionStatus>
