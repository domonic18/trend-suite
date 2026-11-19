/**
 * 一次性工具：把本机开发库的「预览演示课」整段导出成可在预发库执行的
 * INSERT 语句（列名与取值从 information_schema + SELECT * 自动取，不手写字段）。
 * 只导出演示课相关的行，不碰别的数据。
 */
import { writeFileSync } from 'node:fs'
import pg from 'pg'


const src = new pg.Client({ connectionString: process.env.DATABASE_URL })

const q = (text: string, values: unknown[] = []) => src.query(text, values)

/** information_schema 的数组 udt_name 带下划线前缀（_text → text[]），要转回 SQL 数组类型。 */
function arrayType(udt: string): string {
  return udt.startsWith('_') ? `${udt.slice(1)}[]` : `${udt}[]`
}

/**
 * 按**列类型**决定字面量形态，而不是按 JS 值：jsonb 列里存 JSON 数组时
 * pg 会把它反序列化成 JS 数组，若照数组写会生成 `ARRAY[...]::jsonb[]`——
 * 类型对不上，插入直接报错。
 */
function lit(value: unknown, udt?: string): string {
  if (value === null || value === undefined) return 'NULL'
  if (udt && (udt.endsWith('[]') || udt.startsWith('_'))) {
    const items = Array.isArray(value) ? value : []
    if (items.length === 0) return `ARRAY[]::${arrayType(udt)}`
    return `ARRAY[${items.map((item) => lit(item)).join(',')}]`
  }
  if (udt === 'jsonb' || udt === 'json') {
    return `'${JSON.stringify(value)}'::jsonb`
  }
  if (value instanceof Date) return `'${value.toISOString()}'::timestamptz`
  if (Array.isArray(value)) return `'${JSON.stringify(value)}'::jsonb`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return `'${JSON.stringify(value)}'::jsonb`
  return `'${String(value).replace(/'/g, "''")}'`
}

async function tableColumns(table: string): Promise<{ name: string; udt: string }[]> {
  const res = await q(
    `SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [table],
  )
  return res.rows.map((row) => ({ name: row.column_name as string, udt: row.udt_name as string }))
}

/**
 * 媒体路径改写：本机开发库存的是本机绝对路径，预发容器里挂载点是 /media。
 * 用 MEDIA_PATH_FROM / MEDIA_PATH_TO 指定一对前缀；不设则原样保留。
 */
const MEDIA_FROM = process.env.MEDIA_PATH_FROM
const MEDIA_TO = process.env.MEDIA_PATH_TO

function rewritePath(value: unknown): unknown {
  if (typeof value !== 'string' || !MEDIA_FROM || !MEDIA_TO) return value
  return value.startsWith(MEDIA_FROM) ? `${MEDIA_TO}${value.slice(MEDIA_FROM.length)}` : value
}

async function dump(table: string, where: string, values: unknown[]): Promise<string> {
  const columns = await tableColumns(table)
  const res = await q(`SELECT * FROM ${table} WHERE ${where}`, values)
  if (res.rows.length === 0) return ''
  const lines = res.rows.map((row) => {
    const cols = columns.filter((column) => row[column.name] !== undefined)
    const vals = cols
      .map((column) => lit(rewritePath(row[column.name]), column.udt))
      .join(', ')
    return `INSERT INTO ${table} (${cols.map((column) => column.name).join(', ')}) VALUES (${vals});`
  })
  return lines.join('\n')
}

await src.connect()
try {
  const chunks: string[] = ['BEGIN;']
  const courseRow = await q(`SELECT id FROM courses WHERE title LIKE '预览演示%' LIMIT 1`)
  if (courseRow.rows.length === 0) throw new Error('演示课不存在（先跑 seed-preview.ts）')
  const COURSE_ID = courseRow.rows[0].id as string
  const assetRow = await q(`SELECT id FROM media_assets WHERE course_id = $1 LIMIT 1`, [COURSE_ID])
  const ASSET_ID = assetRow.rows[0].id as string
  const userRow = await q(`SELECT id FROM users WHERE username = 'preview_demo' LIMIT 1`)
  if (userRow.rows.length === 0) throw new Error('演示用户不存在')
  const USER_ID = userRow.rows[0].id as string
  chunks.push(
    await dump('users', 'id = $1', [USER_ID]),
    await dump('courses', 'id = $1', [COURSE_ID]),
    await dump('sections', 'course_id = $1', [COURSE_ID]),
    await dump('concepts', 'course_id = $1', [COURSE_ID]),
    await dump('media_assets', 'course_id = $1', [COURSE_ID]),
    await dump('source_units', 'course_id = $1', [COURSE_ID]),
    await dump('media_frames', 'asset_id = $1', [ASSET_ID]),
    await dump('section_case_stocks', 'course_id = $1', [COURSE_ID]),
    await dump('figures', 'course_id = $1', [COURSE_ID]),
    await dump('quote_bars', `code = '600519' AND period = '1w'`, []),
    await dump('widget_specs', 'course_id = $1', [COURSE_ID]),
    await dump('widget_validations', `widget_id IN (SELECT id FROM widget_specs WHERE course_id = $1)`, [COURSE_ID]),
  )
  chunks.push('COMMIT;')
  const sql = chunks.filter((chunk) => chunk.trim() !== '').join('\n\n')
  writeFileSync('/tmp/staging-seed.sql', sql)
  console.log('[export] /tmp/staging-seed.sql', sql.length, 'bytes')
} finally {
  await src.end()
}
