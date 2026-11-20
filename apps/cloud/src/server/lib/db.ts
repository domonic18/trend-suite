import 'server-only'
import pg from 'pg'
import { getEnv } from '@/env'

let pool: pg.Pool | undefined

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      // 等不到可用连接时最多等 30 秒再报错——默认是无限等，请求与任务会永久挂住
      //（2026-11-20 预发实锤：worker 卡在认领查询上，排队任务二十多分钟无人认领）。
      connectionTimeoutMillis: 30_000,
      // 空闲连接 30 秒回收 + TCP keepalive：被防火墙静默掐掉的连接不会在下次取用时才暴露。
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    })
  }
  return pool
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await db().query<T>(text, values)
  return result.rows
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values)
  return rows[0] ?? null
}

/** 产物写入的单事务边界：全部落库或全部回滚，绝不部分落库（arch/03 §4）。 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
