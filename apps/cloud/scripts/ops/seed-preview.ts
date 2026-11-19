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
import { widgetSpec } from '@trend-suite/contracts'
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

## 1.4 老师标注与逐根回放

:::annotation unitId="su_e5e5e5e5e5e5e5e5" assetId="ast_d4d4d4d4d4d4d4d4" code="600519" kind="structure" atMs="30000"
{"d":"2024-03-15","label":"趋势的第一根确认 K 线","quote":"这一根之后，高点才真的开始抬升——趋势从这儿才算成立。","glossary":["趋势"]}
:::

:::replay code="600519" caption="贵州茅台周线逐根回放：每根先判断，再揭晓"
:::
`

/** 演示行情（目检用）：贵州茅台周线，13 根，缓慢上行——回放课件的真实 bars 源。 */
const DEMO_BARS = [
  { d: '2024-03-01', o: 1660, h: 1700, l: 1640, c: 1690, v: 210_000 },
  { d: '2024-03-08', o: 1690, h: 1740, l: 1680, c: 1725, v: 230_000 },
  { d: '2024-03-15', o: 1725, h: 1780, l: 1700, c: 1770, v: 260_000 },
  { d: '2024-03-22', o: 1770, h: 1790, l: 1720, c: 1740, v: 250_000 },
  { d: '2024-03-29', o: 1740, h: 1800, l: 1730, c: 1790, v: 240_000 },
  { d: '2024-04-05', o: 1790, h: 1830, l: 1770, c: 1810, v: 220_000 },
  { d: '2024-04-12', o: 1810, h: 1840, l: 1770, c: 1780, v: 235_000 },
  { d: '2024-04-19', o: 1780, h: 1820, l: 1760, c: 1805, v: 225_000 },
  { d: '2024-04-26', o: 1805, h: 1880, l: 1795, c: 1865, v: 275_000 },
  { d: '2024-05-03', o: 1865, h: 1900, l: 1830, c: 1845, v: 255_000 },
  { d: '2024-05-10', o: 1845, h: 1870, l: 1800, c: 1815, v: 245_000 },
  { d: '2024-05-17', o: 1815, h: 1850, l: 1780, c: 1840, v: 250_000 },
  { d: '2024-05-24', o: 1840, h: 1890, l: 1830, c: 1875, v: 265_000 },
]

const CITATIONS = [UNIT_ID]

/** 11 类课件的演示 spec（目检用）：形状过契约严校验，断言证明记 pass。 */
const DEMO_WIDGETS: { id: string; type: string; code: string | null; spec: unknown }[] = [
  {
    id: 'wid_a100000000000001',
    type: 'kline-annotator',
    code: null,
    spec: {
      type: 'kline-annotator',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { trendlineTouches: { min: 2 }, slopeRange: { min: 0, max: 90 }, noBreakBelow: true },
      data: { generator: 'uptrend', seed: 7, bars: 60 },
      task: '在这张图上点两个锚点，画出你认为的趋势线——系统会当场判你画得对不对。',
      solution: { trendline: { startIdx: 5, endIdx: 40 } },
      annotations: [{ idx: 12, label: '起涨确认', kind: 'structure' }],
    },
  },
  {
    id: 'wid_a100000000000002',
    type: 'pattern-quiz',
    code: null,
    spec: {
      type: 'pattern-quiz',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { answerUnique: true, distractorsDistinct: true },
      data: { generator: 'uptrend', seed: 11, bars: 40 },
      question: '哪一条是上升趋势？',
      options: [
        { id: 'up', label: 'A 上升', generator: 'uptrend', seed: 11, bars: 40 },
        { id: 'down', label: 'B 下降', generator: 'downtrend', seed: 22, bars: 40 },
        { id: 'flat', label: 'C 横盘', generator: 'range', seed: 33, bars: 40 },
      ],
      answerId: 'up',
    },
  },
  {
    id: 'wid_a100000000000003',
    type: 'mcq-quiz',
    code: null,
    spec: {
      type: 'mcq-quiz',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { answerUnique: true, termsInConcepts: true },
      question: '判断趋势首先要看什么？',
      options: [
        { id: 'a', label: '价格相对关键点的位置' },
        { id: 'b', label: '当下的成交量放大' },
        { id: 'c', label: '均线之间的排列顺序' },
      ],
      answerId: 'a',
      conceptRefs: ['趋势'],
    },
  },
  {
    id: 'wid_a100000000000004',
    type: 'step-reveal',
    code: null,
    spec: {
      type: 'step-reveal',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { markersInRange: true, conclusionsNonEmpty: true },
      data: { generator: 'uptrend', seed: 5, bars: 60 },
      steps: [
        {
          title: '第一步：定位置',
          fromIdx: 0,
          toIdx: 19,
          markers: [{ idx: 8, price: 104, label: '起点' }],
          conclusion: '先看当前价在关键点之上还是之下——位置错了，后面都不用看。',
        },
        {
          title: '第二步：看速度',
          fromIdx: 20,
          toIdx: 39,
          markers: [{ idx: 30, price: 118, label: '加速' }],
          conclusion: '斜率变陡说明推进在加速，但加速不等于反转已经发生。',
        },
        {
          title: '第三步：数持续',
          fromIdx: 40,
          toIdx: 59,
          conclusion: '跨越的 K 线根数够多，趋势才算成立——一次冲高不算。',
        },
      ],
      finalConclusion: '位置、速度、持续性三件事依次过，任何一件不成立都要先停下来。',
    },
  },
  {
    id: 'wid_a100000000000005',
    type: 'calc-trainer',
    code: null,
    spec: {
      type: 'calc-trainer',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { examplesRecomputable: true, paramsInBounds: true },
      formula: 'risk-reward',
      inputs: { entryPrice: 1700, stopPrice: 1650, targetPrice: 1850 },
      examples: [
        { inputs: { entryPrice: 1700, stopPrice: 1650, targetPrice: 1850 }, answer: 3 },
        { inputs: { entryPrice: 1800, stopPrice: 1700, targetPrice: 2100 }, answer: 3 },
      ],
      tolerance: 1e-6,
    },
  },
  {
    id: 'wid_a100000000000006',
    type: 'flashcards',
    code: null,
    spec: {
      type: 'flashcards',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { termsInConcepts: true, cardCount: { min: 3, max: 20 } },
      cards: [
        { front: '趋势', back: '价格运行方向在时间上的延续性，由位置、速度、持续性三要素界定。', conceptRef: '趋势' },
        { front: '位置', back: '当前价相对前一关键点的高低——先定位置，再谈方向。', conceptRef: '趋势' },
        { front: '持续性', back: '趋势跨越的 K 线根数，一次冲高不构成趋势。', conceptRef: '趋势' },
      ],
    },
  },
  {
    id: 'wid_a100000000000007',
    type: 'checklist',
    code: null,
    spec: {
      type: 'checklist',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { itemsNonEmpty: true },
      title: '判断趋势前的四项检查',
      items: [
        { text: '周期是否一致（日线结论不要直接套周线）', conceptRef: '趋势' },
        { text: '高低点是否依次抬升', conceptRef: '趋势' },
        { text: '量能是否配合', conceptRef: '趋势' },
        { text: '级别之间是否互相印证', conceptRef: '趋势' },
      ],
    },
  },
  {
    id: 'wid_a100000000000008',
    type: 'timeline-explorer',
    code: null,
    spec: {
      type: 'timeline-explorer',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { edgeRefsExist: true, acyclicPrerequisite: true },
      nodes: [{ conceptRef: '趋势' }, { conceptRef: '级别' }],
      edges: [{ from: '级别', to: '趋势', kind: 'prerequisite' }],
    },
  },
  {
    id: 'wid_a100000000000009',
    type: 'image-juxtaposition',
    code: null,
    spec: {
      type: 'image-juxtaposition',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { pairSidesValid: true, captionsGrounded: true },
      left: { figureId: 'fig_b8b8b8b8b8b8b8b8' },
      right: { generator: 'uptrend', seed: 41, bars: 60 },
      labels: { left: '课程图示', right: '合成 K 线' },
      captions: { left: '密集与发散：趋势的两种形态。', right: '同样的位置关系，换成真实 K 线口径。' },
    },
  },
  {
    id: 'wid_a10000000000000a',
    type: 'branching-scenario',
    code: null,
    spec: {
      type: 'branching-scenario',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { graphAcyclic: true, allPathsTerminate: true, optimalPathReachable: true, feedbackNonEmpty: true },
      scenario: '持仓浮亏，趋势看起来走坏了——你怎么办？',
      nodes: [
        {
          id: 'n1',
          prompt: '第一件事做什么？',
          options: [{ label: '先确认结构是否破坏', next: 'n2', feedback: '对，先看结构，不看情绪。' }],
        },
        {
          id: 'n2',
          prompt: '结构确认破，下一步？',
          options: [{ label: '按纪律离场', next: null, feedback: '结构破了就该走，保住本金比赚最后一根强。' }],
        },
      ],
      entryId: 'n1',
      optimalPath: ['n1', 'n2'],
    },
  },
  {
    id: 'wid_a10000000000000b',
    type: 'bar-replay-decision',
    code: '600519',
    spec: {
      type: 'bar-replay-decision',
      specVersion: 1,
      citations: CITATIONS,
      assertions: { answerUnique: true, decisionPointsGrounded: true, revealMonotonic: true, annotationTermsGrounded: true },
      code: '600519',
      window: { from: '2024-03-01', to: '2024-05-30' },
      period: '1w',
      overlays: [{ atDate: '2024-03-15', label: '起涨确认' }],
      annotations: [
        { unitId: UNIT_ID, atMs: 30000, kind: 'structure', d: '2024-03-15', label: '趋势的第一根确认 K 线' },
        { unitId: UNIT_ID, atMs: 30000, kind: 'invalidation', d: '2024-04-19', label: '跌破结构位，趋势失效' },
      ],
      decisions: [
        {
          atDate: '2024-03-15',
          question: '这根放量收阳之后，你的判断是？',
          options: [{ label: '趋势成立，继续持有' }, { label: '冲高回落，卖出' }],
          correct: '趋势成立，继续持有',
          revealText: '高点抬升且回踩不破前低，趋势的三要素里位置与持续性都过关了。',
          unitId: UNIT_ID,
          atMs: 30000,
        },
        {
          atDate: '2024-04-19',
          question: '这根跌破前低，接下来怎么办？',
          options: [{ label: '继续持有' }, { label: '按纪律离场' }],
          correct: '按纪律离场',
          revealText: '结构破坏优先于任何理由，这一段的判断点在原片里有讲。',
          unitId: UNIT_ID,
          atMs: 30000,
        },
      ],
    },
  },
]

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
     VALUES ('sec_c3c3c3c3c3c3c3c3', $1, $2, '趋势的定义与判断依据', 1, 'complete', 2, $3, 'draft')
     ON CONFLICT (course_id, section_id) DO UPDATE SET body = EXCLUDED.body, body_status = 'draft', dsl_version = 2`,
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

  // 回放课件要真实行情：贵州茅台周线（目检用的演示数值，口径同 quote_bars）。
  await client.query('DELETE FROM quote_bars WHERE code = $1 AND period = $2', ['600519', '1w'])
  for (const [i, bar] of DEMO_BARS.entries()) {
    await client.query(
      `INSERT INTO quote_bars (code, period, trade_date, open, high, low, close, volume)
       VALUES ('600519', '1w', $1, $2, $3, $4, $5, $6)`,
      [bar.d, bar.o, bar.h, bar.l, bar.c, bar.v],
    )
    void i
  }

  // 11 类课件（目检用）：spec 过契约严校验才落库，断言证明记 pass。
  await client.query('DELETE FROM widget_specs WHERE course_id = $1 AND section_id = $2', [COURSE_ID, SECTION_ID])
  for (const item of DEMO_WIDGETS) {
    const spec = widgetSpec.parse(item.spec)
    await client.query(
      `INSERT INTO widget_specs (id, course_id, section_id, type, code, spec_version, version, spec)
       VALUES ($1, $2, $3, $4, $5, 1, 1, $6)
       ON CONFLICT (id) DO UPDATE SET spec = EXCLUDED.spec, version = widget_specs.version + 1`,
      [item.id, COURSE_ID, SECTION_ID, item.type, item.code, JSON.stringify(spec)],
    )
    for (const assertion of Object.keys(spec.assertions)) {
      await client.query(
        `INSERT INTO widget_validations (widget_id, assertion, status, params, detail)
         VALUES ($1, $2, 'pass', $3, '演示数据：断言已由程序证明')
         ON CONFLICT (widget_id, assertion) DO UPDATE SET status = 'pass', proven_at = now()`,
        [item.id, assertion, JSON.stringify(spec.assertions[assertion] ?? true)],
      )
    }
  }

  await client.query('COMMIT')
  console.log('[seed-preview] 就绪：课程', COURSE_ID, '节', SECTION_ID, '· 课件', DEMO_WIDGETS.length, '份')
} catch (err) {
  await client.query('ROLLBACK')
  console.error('[seed-preview] 失败', err)
  process.exit(1)
} finally {
  await client.end()
}
