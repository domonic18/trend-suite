import 'server-only'
import pg from 'pg'
import { getEnv } from '@/env'

let pool: pg.Pool | undefined

export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: getEnv().DATABASE_URL, max: 10 })
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
