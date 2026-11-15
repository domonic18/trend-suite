// 数据库迁移入口：按序执行 db/migrations/*.sql（台账制幂等，Postgres DDL 事务化）。
//
// 语义（与 CI 两个迁移守卫同契约，改动需三处同步）：
//   - 文件名排序即执行顺序；_migrations 台账记录已应用版本，二次运行零动作；
//   - 每个迁移在独立事务内执行（PG 的 DDL 可回滚），失败即 ROLLBACK 并以非零退出——
//     发布流程把「迁移先行」当硬门禁（deploy.sh 迁移失败即中止发布），
//     绝不允许「部分应用后假装成功」；
//   - 多语句迁移文件走 PG 简单查询协议整体提交（node-postgres 无参数文本查询），
//     文件内不得夹带事务控制语句（BEGIN/COMMIT），整个文件就是一个事务单元。
//
// 环境变量：
//   DATABASE_URL     必填，目标库连接串
//   MIGRATIONS_DIR   选填，迁移目录覆盖（CI 增量守卫用来跑 origin/main 的迁移基线）
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const migrationsDir =
  process.env.MIGRATIONS_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations')
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('[migrate] 未设置 DATABASE_URL，无法执行迁移')
  process.exit(1)
}

const files = (await readdir(migrationsDir))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()

try {
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const { rows } = await client.query('SELECT version FROM _migrations')
  const applied = new Set(rows.map((r) => r.version as string))

  let count = 0
  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await client.query('BEGIN')
    try {
      if (sql.trim()) await client.query(sql)
      await client.query('INSERT INTO _migrations (version) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
    count += 1
    console.log(`[migrate] applied ${file}`)
  }
  console.log(`[migrate] applied=${count}, total=${files.length}`)
  if (count === 0) console.log('[migrate] 全部迁移已应用，零动作')
} finally {
  await client.end()
}
