/**
 * 种子账号：幂等创建初始管理员，运营才能在管理台建教师账号。
 *
 * 凭据只走环境变量（BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD），
 * 不进仓库、不进日志。账号已存在则跳过——重跑不覆盖既有凭据。
 */
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { accountPassword, username as usernameSchema } from '@trend-suite/contracts'
import { hashPassword } from '../../src/server/lib/crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[seed] 未设置 DATABASE_URL，无法执行')
  process.exit(1)
}

const username = process.env.BOOTSTRAP_ADMIN_USERNAME
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD

if (!username || !password) {
  console.log('[seed] 未设置 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD，跳过种子账号')
  process.exit(0)
}

// 凭据来自 env 文件，属外部输入：按建号契约校验，
// 否则会种出一个登录时过不了校验的账号（发布时才发现，运维无从下手）
if (!usernameSchema.safeParse(username).success) {
  console.error('[seed] BOOTSTRAP_ADMIN_USERNAME 不符合用户名规则（3-64 位，小写字母/数字开头，可含 . _ -）')
  process.exit(1)
}

if (!accountPassword.safeParse(password).success) {
  console.error('[seed] BOOTSTRAP_ADMIN_PASSWORD 至少 8 个字符')
  process.exit(1)
}

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  const existing = await client.query('SELECT id FROM users WHERE username = $1', [username])
  if ((existing.rowCount ?? 0) > 0) {
    console.log(`[seed] 管理员 ${username} 已存在，跳过`)
  } else {
    const id = `usr_${randomBytes(8).toString('hex')}`
    const hash = await hashPassword(password)
    await client.query(
      `INSERT INTO users (id, username, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4, 'admin')`,
      [id, username, hash, '初始管理员'],
    )
    console.log(`[seed] 已创建管理员 ${username}`)
  }
} finally {
  await client.end()
}
