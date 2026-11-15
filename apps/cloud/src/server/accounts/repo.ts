import 'server-only'
import { query, queryOne } from '@/server/lib/db'

export type UserRow = {
  id: string
  username: string
  password_hash: string
  display_name: string | null
  role: string
  status: string
  created_at: Date
}

export type SessionRow = {
  id: string
  user_id: string
  token_hash: string
  expires_at: Date
  revoked_at: Date | null
}

const USER_COLUMNS = 'id, username, password_hash, display_name, role, status, created_at'

export function findUserByUsername(username: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE username = $1`, [username])
}

export function findUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id])
}

export function listUsers(): Promise<UserRow[]> {
  return query<UserRow>(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`)
}

export async function insertUser(input: {
  id: string
  username: string
  passwordHash: string
  displayName: string | null
  role: string
}): Promise<UserRow> {
  const row = await queryOne<UserRow>(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_COLUMNS}`,
    [input.id, input.username, input.passwordHash, input.displayName, input.role],
  )
  if (!row) throw new Error('用户写入失败')
  return row
}

export async function insertSession(input: {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
}): Promise<void> {
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [input.id, input.userId, input.tokenHash, input.expiresAt],
  )
}

export function findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>(
    'SELECT id, user_id, token_hash, expires_at, revoked_at FROM sessions WHERE token_hash = $1',
    [tokenHash],
  )
}

export async function revokeSessionByTokenHash(tokenHash: string): Promise<void> {
  await query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    tokenHash,
  ])
}
