import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../db/migrations')

/**
 * 开发库连接串在模块加载时抓一次：测试用例会把自己的库覆盖进 process.env.DATABASE_URL
 * （db 池是懒加载的，首次查询才读 env），到那时再比就只剩「同一个库」了，
 * 守卫会把合法的测试库误判成开发库。
 */
const devDatabaseUrl = process.env.DATABASE_URL

/**
 * 测试库守卫（arch/01 §2.4）：测试库必须与开发库不同——测试会清空目标库，
 * 同库即拦截。没配 TEST_DATABASE_URL 时返回 null，由调用方跳过数据库用例。
 */
export function testDatabaseUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL
  if (!url) return null
  if (devDatabaseUrl && devDatabaseUrl === url) {
    throw new Error('TEST_DATABASE_URL 与 DATABASE_URL 指向同一个库——测试会清空目标库，拒绝执行')
  }
  return url
}

/** 从迁移文件重放出一个干净的测试库：迁移即 schema 的单一真相源（arch/03 §5）。 */
export async function resetTestDatabase(): Promise<void> {
  const url = testDatabaseUrl()
  if (!url) return

  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of files) {
      const sql = await readFile(join(migrationsDir, file), 'utf8')
      if (sql.trim()) await client.query(sql)
    }
  } finally {
    await client.end()
  }
}
