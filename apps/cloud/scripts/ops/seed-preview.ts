/**
 * 预览目检种子：造一条「正文已产出」的课，供管理台预览页目检。
 * 只写本机运行期数据（workspace 媒体目录与本地库），不入库、不触线上环境。
 *
 * 用法：PREVIEW_DEMO_PASSWORD=<口令> node --env-file-if-exists=.env \
 *   --conditions=react-server --import tsx scripts/ops/seed-preview.ts
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pg from 'pg'
import { renderDiagram } from '../../src/server/content/textbook/diagram-renderer'
import { hashPassword } from '../../src/server/lib/crypto'

const databaseUrl = process.env.DATABASE_URL
const mediaRoot = process.env.MEDIA_LOCAL_DIR
if (!databaseUrl || !mediaRoot) {
  console.error('[seed-preview] 需要 DATABASE_URL 与 MEDIA_LOCAL_DIR')
  process.exit(1)
}

const COURSE_ID = 'crs_b2b2b2b2b2b2b2b2'
const SECTION_ID = '1-1'
const ASSET_ID = 'ast_d4d4d4d4d4d4d4d4'
const UNIT_ID = 'su_e5e5e5e5e5e5e5e5'
const FRAME_ID = 'frm_f6f6f6f6f6f6f6f6'

const body = `# 1. 趋势的定义与判断依据

## 1.1 什么是趋势

**趋势**是价格运行方向在时间上的延续。判断趋势不靠感觉，靠三件事：
位置（相对关键点的高低）、速度（斜率）、持续性（跨越的 K 线根数）。
老师在原片里反复强调：**先定位置，再看速度，最后才谈形态** [[unit:su_e5e5e5e5e5e5e5e5|原片讲解：趋势的三要素]]。

:::sidenote title="趋势"
趋势指价格运行方向在时间上的延续性，由位置、速度、持续性三要素共同界定。
:::

:::cards
{"items":[{"num":"1","title":"先定位置","desc":"看当前价相对前一关键点的高低"},{"num":"2","title":"再看速度","desc":"用斜率衡量推进的快慢"},{"num":"3","title":"最后看持续","desc":"数清跨越的 K 线根数"}]}
:::

## 1.2 判断依据

判断依据来自老师板书：[[stock:600519|贵州茅台]]在这段行情里同时满足三要素。
:::board unitId="su_e5e5e5e5e5e5e5e5"
先看位置，再看斜率，最后数根数——顺序不能反。
:::

:::bignum
{"items":[{"label":"回踩确认","value":"3 根","note":"连续 K 线不破前低"},{"label":"趋势段跨度","value":"42 根"}]}
:::

:::warn title="常见误用：把反弹当反转" variant="misuse"
斜率变陡不等于趋势反转；必须先出现结构破坏（跌破关键点），再谈方向。
:::

:::cmp mode="card"
{"title":"两种读盘方式","left":{"head":"主观","items":["看盘感","凭印象","难以复盘"]},"right":{"head":"可验证","items":["位置/速度/持续","逐项检查","可回溯到录像"]}}
:::

:::timeline
{"events":[{"date":"2024-03-01","title":"起涨"},{"date":"2024-04-18","title":"回踩确认"},{"date":"2024-05-30","title":"趋势段完成"}]}
:::

## 1.3 实例与检查清单

本节用 [[stock:600519|贵州茅台]] 的真实周线做实例，看三要素如何落到图上。

:::figure figureId="fig_b8b8b8b8b8b8b8b8" caption="密集与发散对比示意"
:::

:::figure figureId="fig_b8b8b8b8b8b8b8b9" caption="原片关键帧：趋势线画法"
:::

:::figure figureId="fig_b8b8b8b8b8b8b8ba" caption="装饰图：章节封面"
:::

:::clip assetId="ast_d4d4d4d4d4d4d4d4" from="20" to="50" caption="老师演示画趋势线" unitId="su_e5e5e5e5e5e5e5e5"
:::

:::think title="想一想"
如果位置与速度矛盾，以哪个为准？为什么？
:::

- 位置优先于速度
- 结构破坏才算真反转
- 每一条结论都要能回溯到原片

:::warn title="风险提示" variant="risk"
本节图示为录制时点的前复权口径，与当前行情存在除权漂移；不构成投资建议。
:::
`

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  await client.query('BEGIN')
  // 用户（管理员）——口令走正式哈希；口令只从 env 读，不落仓库。
  const password = process.env.PREVIEW_DEMO_PASSWORD
  if (!password) {
    console.error('[seed-preview] 需要 PREVIEW_DEMO_PASSWORD 环境变量')
    process.exit(1)
  }
  const user = await client.query<{ id: string }>(
    `INSERT INTO users (id, username, password_hash, display_name, role)
     VALUES ('usr_a1a1a1a1a1a1a1a1', 'preview_demo', $1, '预览演示', 'admin')
     ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = '预览演示'
     RETURNING id`,
    [await hashPassword(password)],
  )
  const ownerId = user.rows[0]!.id

  await client.query(
    `INSERT INTO courses (id, owner_id, title, status, goal)
     VALUES ($1, $2, '预览演示课：趋势入门', 'draft', '目检用')
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
    [COURSE_ID, ownerId],
  )
  await client.query(
    `INSERT INTO sections (id, course_id, section_id, title, sort_order, status, dsl_version, body, body_status)
     VALUES ('sec_c3c3c3c3c3c3c3c3', $1, $2, '趋势的定义与判断依据', 1, 'complete', 1, $3, 'draft')
     ON CONFLICT (course_id, section_id) DO UPDATE SET body = EXCLUDED.body, body_status = 'draft'`,
    [COURSE_ID, SECTION_ID, body],
  )
  await client.query(
    `INSERT INTO concepts (id, course_id, name, aliases, definition, status)
     VALUES ('cpt_c9c9c9c9c9c9c9c9', $1, '趋势', ARRAY['趋势段','行情趋势'], '价格运行方向在时间上的延续性', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [COURSE_ID],
  )
  await client.query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, sha256, byte_size, duration_s, status, video_ok, audio_ok, hls_path)
     VALUES ($1, $2, 'preview-demo.mp4', 'sources/ast_d4d4d4d4d4d4d4d4/source', 'deadbeef', 1024, 300, 'ready', true, true, NULL)
     ON CONFLICT (id) DO NOTHING`,
    [ASSET_ID, COURSE_ID],
  )
  await client.query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, visual_desc, extra)
     VALUES ($1, $2, $3, 20000, 50000, '趋势的三要素：位置、速度、持续性。老师在白板上画了一条上升趋势线。', '讲师手绘趋势线，右侧屏幕是贵州茅台周线图。', '{"chartType":"line","teachingPoints":["位置优先于速度","斜率看推进快慢"],"frameIds":[]}')
     ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text`,
    [UNIT_ID, COURSE_ID, ASSET_ID],
  )
  // 帧地址存绝对路径（与抽帧管线一致：framesDir 下按 at_ms 命名）。
  const framePath = join(mediaRoot, 'sources', ASSET_ID, 'frames', '30000.jpg')
  await client.query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path, width, height)
     VALUES ($1, $2, 30000, $3, 1280, 720)
     ON CONFLICT (id) DO UPDATE SET path = EXCLUDED.path`,
    [FRAME_ID, ASSET_ID, framePath],
  )
  await client.query(
    `INSERT INTO section_case_stocks (id, course_id, section_id, code, name, exchange, period, window_start, window_end, events)
     VALUES ('cst_a7a7a7a7a7a7a7a7', $1, $2, '600519', '贵州茅台', 'SH', '1w', '2024-03-01', '2024-05-30', '[]')
     ON CONFLICT (id) DO NOTHING`,
    [COURSE_ID, SECTION_ID],
  )

  // 图示三路
  const { svg } = renderDiagram('chip-contrast', {
    title: '密集与发散',
    leftLabel: '密集',
    rightLabel: '发散',
    leftCount: 12,
    rightCount: 5,
  })
  await client.query(
    `INSERT INTO figures (id, course_id, section_id, kind, caption, unit_id, asset_id, sec, template, params, svg)
     VALUES ('fig_b8b8b8b8b8b8b8b8', $1, $2, 'diagram', '密集与发散对比示意', NULL, NULL, NULL, 'chip-contrast', $3, $4)
     ON CONFLICT (id) DO UPDATE SET svg = EXCLUDED.svg, params = EXCLUDED.params`,
    [COURSE_ID, SECTION_ID, JSON.stringify({
      title: '密集与发散', leftLabel: '密集', rightLabel: '发散', leftCount: 12, rightCount: 5,
    }), svg],
  )
  await client.query(
    `INSERT INTO figures (id, course_id, section_id, kind, caption, unit_id, asset_id, sec, frame_id)
     VALUES ('fig_b8b8b8b8b8b8b8b9', $1, $2, 'keyframe', '原片关键帧：趋势线画法', $3, $4, 30, $5)
     ON CONFLICT (id) DO NOTHING`,
    [COURSE_ID, SECTION_ID, UNIT_ID, ASSET_ID, FRAME_ID],
  )
  const genPath = join(mediaRoot, 'figures', 'fig_b8b8b8b8b8b8b8ba', 'gen_1.jpg')
  await mkdir(dirname(genPath), { recursive: true })
  await writeFile(genPath, Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ))
  await client.query(
    `INSERT INTO figures (id, course_id, section_id, kind, caption, prompt, path)
     VALUES ('fig_b8b8b8b8b8b8b8ba', $1, $2, 'generated', '装饰图：章节封面', '教材章节封面插画', $3)
     ON CONFLICT (id) DO UPDATE SET path = EXCLUDED.path`,
    [COURSE_ID, SECTION_ID, genPath],
  )

  // 关键帧图片（帧路由按 media_frames.path 读盘）
  await mkdir(dirname(framePath), { recursive: true })
  await writeFile(framePath, Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ))

  await client.query('COMMIT')
  console.log('[seed-preview] 就绪：课程', COURSE_ID, '节', SECTION_ID)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('[seed-preview] 失败', err)
  process.exit(1)
} finally {
  await client.end()
}
