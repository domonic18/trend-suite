import 'server-only'
import type { AccountView, SessionUser, UserRole, UserStatus } from '@trend-suite/contracts'
import { conflict } from '@/server/lib/http'
import { generateToken, hashPassword, hashToken, verifyPassword } from '@/server/lib/crypto'
import { newId } from '@/server/lib/ids'
import * as repo from './repo'

/** Web 会话有效期：工作台是长任务场景，12 小时够一轮验收。 */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function toAccountView(row: repo.UserRow): AccountView {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
  }
}

function toSessionUser(row: repo.UserRow): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    displayName: row.display_name,
  }
}

export async function createAccount(input: {
  username: string
  password: string
  role: UserRole
  displayName?: string | undefined
}): Promise<AccountView> {
  const existing = await repo.findUserByUsername(input.username)
  if (existing) throw conflict('该用户名已被占用')

  const passwordHash = await hashPassword(input.password)
  try {
    const row = await repo.insertUser({
      id: newId('user'),
      username: input.username,
      passwordHash,
      displayName: input.displayName ?? null,
      role: input.role,
    })
    return toAccountView(row)
  } catch (err) {
    // 并发建同名账号：唯一索引兜底，报冲突而不是 500
    if (isUniqueViolation(err)) throw conflict('该用户名已被占用')
    throw err
  }
}

export function listAccounts(): Promise<AccountView[]> {
  return repo.listUsers().then((rows) => rows.map(toAccountView))
}

export async function startSession(
  username: string,
  password: string,
): Promise<{ token: string; expiresAt: string; user: SessionUser } | null> {
  const row = await repo.findUserByUsername(username)
  if (!row || row.status !== 'active') return null
  const ok = await verifyPassword(password, row.password_hash)
  if (!ok) return null

  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await repo.insertSession({
    id: newId('session'),
    userId: row.id,
    tokenHash: hashToken(token),
    expiresAt,
  })
  return { token, expiresAt: expiresAt.toISOString(), user: toSessionUser(row) }
}

export async function resolveSession(token: string): Promise<SessionUser | null> {
  const session = await repo.findSessionByTokenHash(hashToken(token))
  if (!session || session.revoked_at) return null
  if (session.expires_at.getTime() <= Date.now()) return null
  const user = await repo.findUserById(session.user_id)
  if (!user || user.status !== 'active') return null
  return toSessionUser(user)
}

export async function endSession(token: string): Promise<void> {
  await repo.revokeSessionByTokenHash(hashToken(token))
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  )
}
