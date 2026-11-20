/**
 * 智能规划目检种子：造一门「素材已理解、可做智能规划」的课，供工作台方案页目检。
 * 只写本机开发库（不入库、不触线上环境）。
 *
 * 造完再跑 worker（配 mock LLM）就会走真实起草链路：智能规划 → 规划自检 →
 * 通过才落草案（`plan_reviews` 留自检结论）。
 *
 * 用法：PREVIEW_DEMO_PASSWORD=<口令> node --env-file-if-exists=.env \
 *   --conditions=react-server --import tsx scripts/ops/seed-plan-smart.ts
 */
import pg from 'pg'
import { hashPassword } from '../../src/server/lib/crypto'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[seed-plan-smart] 需要 DATABASE_URL')
  process.exit(1)
}

const COURSE_ID = 'crs_c4c4c4c4c4c4c4c4'
const ASSET_ID = 'ast_c4c4c4c4c4c4c4c4'
const UNIT_IDS = ['su_c4c4c4c4c4c4c41', 'su_c4c4c4c4c4c4c42', 'su_c4c4c4c4c4c4c43']

/** 三段素材的讲解要点——智能规划的输入清单。 */
const UNITS: { id: string; startMs: number; endMs: number; points: string[] }[] = [
  {
    id: UNIT_IDS[0]!,
    startMs: 0,
    endMs: 600000,
    points: ['趋势是价格运行方向在时间上的延续', '趋势由位置、速度、持续性三要素界定'],
  },
  {
    id: UNIT_IDS[1]!,
    startMs: 600000,
    endMs: 1200000,
    points: ['级别由观察的时间尺度决定', '日线级别看不到周线的结构'],
  },
  {
    id: UNIT_IDS[2]!,
    startMs: 1200000,
    endMs: 1800000,
    points: ['回踩不破前低是趋势延续的确认', '结构破坏才是趋势反转'],
  },
]

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  await client.query('BEGIN')
  const password = process.env.PREVIEW_DEMO_PASSWORD
  if (!password) {
    console.error('[seed-plan-smart] 需要 PREVIEW_DEMO_PASSWORD 环境变量')
    process.exit(1)
  }
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ('usr_a1a1a1a1a1a1a1a1', 'preview_demo', $1, '预览演示', 'admin')
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id`,
    [await hashPassword(password)],
  )
  const ownerId = user.rows[0]!.id

  await client.query(
    `INSERT INTO courses (id, owner_id, title, status, goal, plan_mode, plan_asset_ids)
     VALUES ($1, $2, '智能规划演示课：趋势入门', 'draft', '学会用三要素判断趋势', 'smart', ARRAY[$3]::text[])
     ON CONFLICT (id) DO UPDATE SET plan_mode = 'smart', plan_asset_ids = EXCLUDED.plan_asset_ids`,
    [COURSE_ID, ownerId, ASSET_ID],
  )
  await client.query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, sha256, byte_size, duration_s, status, video_ok, audio_ok)
     VALUES ($1, $2, 'smart-demo.mp4', 'sources/ast_c4c4c4c4c4c4c4c4/source', 'deadbeef', 1024, 1800, 'ready', true, true)
     ON CONFLICT (id) DO UPDATE SET status = 'ready'`,
    [ASSET_ID, COURSE_ID],
  )
  for (const [index, unit] of UNITS.entries()) {
    await client.query(
      `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (id) DO UPDATE SET extra = EXCLUDED.extra`,
      [
        unit.id,
        COURSE_ID,
        ASSET_ID,
        unit.startMs,
        unit.endMs,
        unit.points.join('。'),
        JSON.stringify({ teachingPoints: unit.points }),
        index,
      ],
    )
  }
  await client.query('COMMIT')
  console.log(`[seed-plan-smart] 课程 ${COURSE_ID} 就绪（素材已理解，模式 smart）`)
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  await client.end()
}
