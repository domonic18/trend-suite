import { z } from 'zod'
import { accountPassword, username } from './auth.js'
import { userRole, userStatus } from './enums.js'
import { idShape } from './ids.js'

export const createAccountRequest = z.object({
  username,
  password: accountPassword,
  role: userRole,
  displayName: z.string().min(1).max(64).optional(),
})

export const accountView = z.object({
  id: z.string().regex(idShape.user),
  username: z.string(),
  role: userRole,
  status: userStatus,
  displayName: z.string().nullable(),
  createdAt: z.string(),
})

export const createAccountResponse = z.object({ account: accountView })

export const accountListResponse = z.object({ items: z.array(accountView) })

export type CreateAccountRequest = z.infer<typeof createAccountRequest>
export type AccountView = z.infer<typeof accountView>
export type CreateAccountResponse = z.infer<typeof createAccountResponse>
export type AccountListResponse = z.infer<typeof accountListResponse>
