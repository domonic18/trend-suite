import { z } from 'zod'
import { userRole } from './enums'
import { idShape } from './ids'

/** 用户名：登录与建号共用一套形状，避免两端口径漂移。 */
export const username = z
  .string()
  .min(3, '用户名至少 3 个字符')
  .max(64, '用户名最长 64 个字符')
  .regex(
    /^[a-z0-9][a-z0-9_.-]*$/,
    '用户名只允许小写字母、数字、点、下划线与连字符，且以字母或数字开头',
  )

/** 建号口令下限（scrypt 哈希存储，库里不留明文）。 */
export const accountPassword = z.string().min(8, '口令至少 8 个字符').max(256)

export const loginRequest = z.object({
  username,
  password: z.string().min(1, '请输入口令').max(256),
})

export const sessionUser = z.object({
  id: z.string().regex(idShape.user),
  username: z.string(),
  role: userRole,
  displayName: z.string().nullable(),
})

export const loginResponse = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
  user: sessionUser,
})

export const meResponse = z.object({ user: sessionUser })

export const logoutResponse = z.object({ ok: z.literal(true) })

export type SessionUser = z.infer<typeof sessionUser>
export type LoginRequest = z.infer<typeof loginRequest>
export type LoginResponse = z.infer<typeof loginResponse>
export type MeResponse = z.infer<typeof meResponse>
