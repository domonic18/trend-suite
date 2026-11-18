import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { approvePlan } from '@/server/content/plans/service'
import { buildSkeleton, parseOutline } from '@/server/content/plans/outline'
import { glossaryOf, validateConceptMap } from '@/server/content/plans/concepts'
import * as plansRepo from '@/server/content/plans/repo'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { runWorkerOnce, workerId } from '@/server/pipeline/jobs/worker'
import { HttpError } from '@/server/lib/http'
import { getSectionQuotes, resyncProductionQuotes } from './service'
import { listSections, listTasks } from './repo'
import { startMockLlm, type MockLlm } from './mock-llm'
import { startMockQuotes, type MockQuotes } from '@/server/content/quotes/mock-quotes'
import { fetchQuotes } from '@/server/content/quotes/client'
import { recheckCaseStocks, readbackQuotes } from '@/server/content/quotes/service'

/**
 * 迭代 5 验收（docs/plan：案例股与行情，数值可核）：
 * ① 一节产出的案例股清单与 K 线数值和行情源核对一致（fixture 逐根相等 + 客户端列序防错）
 * ② 停掉行情源重跑 → 占位提示、无编造数值；源恢复后「重新同步行情」补数（不重付步骤 1 LLM）
 * ③ 复权口径声明在契约单一事实源（看板渲染走同一字段，浏览器目检覆盖）
 * 另补：复检归一（1d 深度不足→1w）、事件锚点交易日归一、UNIQUE 幂等、运行中 resync 409。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

const mock: MockLlm = await startMockLlm()
const quotesMock: MockQuotes = await startMockQuotes()
process.env.MARKET_QUOTES_BASE_URL = quotesMock.url
after(async () => {
  await mock.close()
  await quotesMock.close()
})

before(async () => {
  if (url) await resetTestDatabase()
  const entry = await createModelEntry({
    name: '行情验收模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: mock.url,
    apiKey: 'sk-test-key',
  })
  for (const task of ['content.case_stocks', 'content.figure_spec', 'content.widget_spec', 'content.section_draft', 'rubric_review']) {
    await updateTaskBinding({ task, primaryModelId: entry.id, backupModelId: null })
  }
})

const OUTLINE_TEXT = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义', '2. 级别的概念'].join('\n')

async function seedApprovedCourse(name: string): Promise<{ teacherId: string; username: string; courseId: string; sectionIds: string[] }> {
  const username = `laoshi-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const outline = parseOutline(OUTLINE_TEXT)
  const { skeleton } = buildSkeleton(
    outline,
    outline.nodes.map((node) => ({ nodeId: node.id, matchScore: 0.9 })),
  )
  const normalized = validateConceptMap({
    concepts: [
      { name: '趋势', aliases: [], definition: '价格运行方向' },
      { name: '级别', aliases: [], definition: '时间尺度' },
    ],
    edges: [{ from: '级别', to: '趋势', kind: 'prerequisite' }],
  })
  await plansRepo.insertPlan({
    id: newId('plan'),
    courseId: course.id,
    version: await plansRepo.nextPlanVersion(course.id),
    status: 'draft',
    origin: 'initial',
    createdBy: teacher.id,
    skeleton,
    conceptMap: normalized.conceptMap,
    glossary: glossaryOf(normalized.conceptMap),
    sectionPlan: { lessons: [] },
    violations: [],
  })
  await approvePlan(teacher, course.id)
  const sections = await listSections(course.id)
  return { teacherId: teacher.id, username, courseId: course.id, sectionIds: sections.map((s) => s.section_id) }
}

async function assertCourseDone(courseId: string): Promise<void> {
  const sections = await listSections(courseId)
  const tasks = await listTasks(courseId)
  assert.ok(sections.length > 0)
  assert.ok(sections.every((s) => s.status === 'complete'), '所有节 complete')
  assert.ok(tasks.every((t) => t.status === 'done'), '所有步 done')
}

// ---------------------------------------------------------------- 纯单元：客户端解析

test('客户端解析：腾讯列序 [日期,开,收,高,低,量] 防错位 + 窗口过滤', { skip }, async () => {
  const bars = await fetchQuotes(
    { code: '000001', exchange: 'SZ' },
    '1d',
    '2024-03-04',
    '2024-03-15',
    { baseUrl: quotesMock.url },
  )
  assert.equal(bars.length, 10)
  const first = bars[0]
  assert.ok(first)
  // fixture：o=1050 c=1058 h=1064 l=1045 v=32000——若列序错位（如 h/c 对调）会立刻暴露。
  assert.deepEqual(first, { d: '2024-03-04', o: 1050, h: 1064, l: 1045, c: 1058, v: 32000 })
  const last = bars[bars.length - 1]
  assert.ok(last)
  assert.equal(last.d, '2024-03-15')
})

test('客户端解析：周期映射 week → qfqweek 键', { skip }, async () => {
  const bars = await fetchQuotes(
    { code: '600519', exchange: 'SH' },
    '1w',
    '2023-01-01',
    '2023-12-31',
    { baseUrl: quotesMock.url },
  )
  assert.equal(bars.length, 13)
  assert.equal(bars[0]?.d, '2023-01-06')
  assert.equal(bars[bars.length - 1]?.d, '2023-12-29')
})

// ---------------------------------------------------------------- 纯单元：云端复检

test('复检归一：1d 窗口早于 2024-03 自动改 1w 并记 note；交易所按前缀校正', { skip }, () => {
  const stocks = recheckCaseStocks({
    stocks: [
      {
        code: '600519',
        name: '贵州茅台',
        exchange: 'SZ', // 故意错报，应由前缀 60 → SH 校正
        period: '1d',
        windowStart: '2023-01-01',
        windowEnd: '2023-06-30',
        events: [{ date: '2023-03-15', label: '年报窗口' }],
      },
      {
        code: '000001',
        name: '平安银行',
        exchange: 'SZ',
        period: '1d',
        windowStart: '2024-03-04',
        windowEnd: '2024-03-15',
        events: [],
      },
    ],
  })
  assert.equal(stocks[0]?.period, '1w')
  assert.deepEqual(stocks[0]?.notes, ['日线深度不足，已自动改用周线', '交易所按代码前缀校正'])
  assert.equal(stocks[0]?.exchange, 'SH')
  assert.equal(stocks[1]?.period, '1d')
  assert.deepEqual(stocks[1]?.notes, [])
})

test('复检结构性违例：窗口倒置 / 事件落窗外 / 数量越界 / 代码不合法', { skip }, () => {
  assert.throws(
    () =>
      recheckCaseStocks({
        stocks: [
          { code: '600519', name: '贵州茅台', exchange: 'SH', period: '1d', windowStart: '2024-06-30', windowEnd: '2024-01-01', events: [] },
          { code: '000001', name: '平安银行', exchange: 'SZ', period: '1d', windowStart: '2024-03-04', windowEnd: '2024-03-15', events: [] },
        ],
      }),
    (err: unknown) => err instanceof Error && err.message.includes('起点晚于终点'),
  )
  assert.throws(
    () =>
      recheckCaseStocks({
        stocks: [
          { code: '600519', name: '贵州茅台', exchange: 'SH', period: '1w', windowStart: '2023-01-01', windowEnd: '2023-06-30', events: [{ date: '2024-01-05', label: '窗外事件' }] },
          { code: '000001', name: '平安银行', exchange: 'SZ', period: '1d', windowStart: '2024-03-04', windowEnd: '2024-03-15', events: [] },
        ],
      }),
    (err: unknown) => err instanceof Error && err.message.includes('不在窗口内'),
  )
  assert.throws(() => recheckCaseStocks({ stocks: [{ code: '600519', name: '贵州茅台', exchange: 'SH', period: '1w', windowStart: '2023-01-01', windowEnd: '2023-06-30', events: [] }] }))
  assert.throws(
    () =>
      recheckCaseStocks({
        stocks: [
          { code: 'abc', name: 'x', exchange: 'SH', period: '1w', windowStart: '2023-01-01', windowEnd: '2023-06-30', events: [] },
          { code: '000001', name: '平安银行', exchange: 'SZ', period: '1d', windowStart: '2024-03-04', windowEnd: '2024-03-15', events: [] },
        ],
      }),
  )
})

// ---------------------------------------------------------------- 集成：验收① 数值可核

test('验收① 同步落库逐根一致 + 事件锚点归一交易日 + 读回 ok', { skip }, async () => {
  const seeded = await seedApprovedCourse('行情验收一课')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)

  const stocks = await query<{ code: string; period: string; window_start: string; window_end: string; notes: unknown }>(
    `SELECT code, period, window_start::text, window_end::text, notes FROM section_case_stocks
     WHERE course_id = $1 AND section_id = $2 ORDER BY code`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
  assert.equal(stocks.length, 2)
  assert.deepEqual(stocks.map((s) => s.code), ['000001', '600519'])
  const maotai = stocks.find((s) => s.code === '600519')
  assert.deepEqual(maotai?.notes, [])

  // K 线数值与 fixture 逐根一致（验收①），行数即根数（UNIQUE 无重复）。
  const bars = await query<{ code: string; trade_date: string; open: string; close: string; volume: string }>(
    `SELECT code, trade_date::text, open::text, close::text, volume::text FROM quote_bars
     WHERE code IN ('600519', '000001')
     ORDER BY code, trade_date`,
    [],
  )
  const daily = bars.filter((b) => b.code === '000001')
  const weekly = bars.filter((b) => b.code === '600519')
  assert.equal(daily.length, 10)
  assert.equal(weekly.length, 13)
  assert.equal(daily[0]?.trade_date, '2024-03-04')
  assert.equal(Number(daily[0]?.open), 1050)
  assert.equal(Number(daily[0]?.close), 1058)
  assert.equal(Number(daily[0]?.volume), 32000)

  // 读回步：状态 ok + 事件锚点归一（2023-10-28 周六 → 2023-10-27 周五）。
  const readback = await readbackQuotes(seeded.courseId, seeded.sectionIds[0] ?? '')
  const byCode = new Map(readback.perStock.map((s) => [s.code, s]))
  assert.equal(byCode.get('000001')?.marketStatus, 'ok')
  assert.equal(byCode.get('600519')?.marketStatus, 'ok')
  const anchors = byCode.get('600519')?.eventAnchors ?? []
  assert.equal(anchors[0]?.date, '2023-10-28')
  assert.equal(anchors[0]?.resolvedDate, '2023-10-27')

  // 行情视图（看板同一数据源）：声明字段 + bars 带回。
  const teacher = { id: seeded.teacherId, username: seeded.username, role: 'producer' } as never
  const view = await getSectionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? '')
  assert.equal(view.stocks.length, 2)
  assert.ok(view.declaration.includes('前复权'))
  assert.ok(view.declaration.includes('不构成投资建议'))
  assert.equal(view.stocks.find((s) => s.code === '600519')?.marketStatus, 'ok')

  // resync 重放：步骤 2/3 重跑、UNIQUE 幂等不增行、步骤 1 不重付（清单行 id 不变）。
  const beforeIds = await query<{ id: string }>(
    `SELECT id FROM section_case_stocks WHERE course_id = $1 AND section_id = $2`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
  await resyncProductionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? '')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)
  const afterBars = await query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM quote_bars WHERE code IN ('600519', '000001')`,
  )
  assert.equal(Number(afterBars[0]?.n), 23)
  const afterIds = await query<{ id: string }>(
    `SELECT id FROM section_case_stocks WHERE course_id = $1 AND section_id = $2`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
  assert.deepEqual(afterIds.map((r) => r.id), beforeIds.map((r) => r.id))
})

test('partial：窗口尾部缺根 → 读回 partial（有数但不齐）', { skip }, async () => {
  const seeded = await seedApprovedCourse('partial课')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)
  await query(`DELETE FROM quote_bars WHERE code = '600519' AND trade_date > '2023-11-24'`)
  const readback = await readbackQuotes(seeded.courseId, seeded.sectionIds[0] ?? '')
  const byCode = new Map(readback.perStock.map((s) => [s.code, s]))
  assert.equal(byCode.get('600519')?.marketStatus, 'partial')
  assert.equal(byCode.get('600519')?.barCount, 12)
  assert.equal(byCode.get('000001')?.marketStatus, 'ok')
})

test('验收② 源挂掉重跑：占位不编造，节照常完成；源恢复后 resync 补数', { skip }, async () => {
  // 第二套案例股（不与验收①的缓存撞键）。
  mock.step1Product = {
    stocks: [
      { code: '600036', name: '招商银行', exchange: 'SH', period: '1d', windowStart: '2024-03-04', windowEnd: '2024-03-15', events: [] },
      { code: '601318', name: '中国平安', exchange: 'SH', period: '1w', windowStart: '2023-01-01', windowEnd: '2023-12-31', events: [] },
    ],
  }
  let seeded: Awaited<ReturnType<typeof seedApprovedCourse>>
  try {
    seeded = await seedApprovedCourse('行情断源课')
    quotesMock.failAll = true
    assert.equal(await runWorkerOnce(workerId()), true)
  } finally {
    quotesMock.failAll = false
    mock.step1Product = null
  }
  await assertCourseDone(seeded.courseId)
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM quote_bars WHERE code IN ('600036', '601318')`,
  )
  assert.equal(Number(rows[0]?.n), 0, '源挂时不落任何 bar（不编造数值）')

  const teacher = { id: seeded.teacherId, username: seeded.username, role: 'producer' } as never
  const view = await getSectionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? '')
  assert.ok(view.stocks.every((s) => s.marketStatus === 'unavailable'))
  assert.ok(view.stocks.every((s) => s.bars.length === 0))

  // 源恢复后重同步：步骤 2/3 重跑补数，节复原 complete（completeSectionIfAllDone）。
  await resyncProductionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? '')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)
  const afterRows = await query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM quote_bars WHERE code IN ('600036', '601318')`,
  )
  assert.equal(Number(afterRows[0]?.n), 23, '恢复后补齐 10 + 13 根')
  const viewAfter = await getSectionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? '')
  assert.ok(viewAfter.stocks.every((s) => s.marketStatus === 'ok'))

  // 步骤 1 是 LLM 付费步：resync 前后清单行不变（不重跑）。
  const runs = await query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM ai_runs r
     JOIN production_tasks t ON t.id = r.ref_id
     WHERE t.course_id = $1 AND t.section_id = $2 AND t.step = 1`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
  assert.ok(Number(runs[0]?.n) >= 1)
})

test('运行中 resync 互斥：409 production_not_retryable', { skip }, async () => {
  const seeded = await seedApprovedCourse('resync互斥课')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)
  const teacher = { id: seeded.teacherId, username: seeded.username, role: 'producer' } as never
  await query(
    `UPDATE production_tasks SET status = 'running' WHERE course_id = $1 AND section_id = $2 AND step = 2`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
  await assert.rejects(
    () => resyncProductionQuotes(teacher, seeded.courseId, seeded.sectionIds[0] ?? ''),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'production_not_retryable',
  )
  await query(
    `UPDATE production_tasks SET status = 'done' WHERE course_id = $1 AND section_id = $2 AND step = 2`,
    [seeded.courseId, seeded.sectionIds[0]],
  )
})

test('缓存语义：源再挂时重同步 → 步骤降级 unavailable，已采集的真实缓存保留', { skip }, async () => {
  const seeded = await seedApprovedCourse('缓存语义课')
  const sectionId = seeded.sectionIds[0] ?? ''
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(seeded.courseId)
  const teacher = { id: seeded.teacherId, username: seeded.username, role: 'producer' } as never

  quotesMock.failAll = true
  try {
    await resyncProductionQuotes(teacher, seeded.courseId, sectionId)
    assert.equal(await runWorkerOnce(workerId()), true)
  } finally {
    quotesMock.failAll = false
  }

  // 步骤 2 产物记录逐股 unavailable（同步确实失败了）……
  const output = await query<{ checkpoint: Record<string, unknown> }>(
    `SELECT checkpoint FROM production_tasks WHERE course_id = $1 AND section_id = $2 AND step = 2`,
    [seeded.courseId, sectionId],
  )
  const sync = (output[0]?.checkpoint as { market_sync?: { perStock: { status: string }[] } } | undefined)?.market_sync
  assert.ok(sync)
  assert.ok(sync.perStock.every((s) => s.status === 'unavailable'))
  // ……但已采集的真实缓存保留（quote_bars 是缓存，不因一次失败清空，更不编造替代值）。
  const rows = await query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM quote_bars WHERE code IN ('600519', '000001')`,
  )
  assert.equal(Number(rows[0]?.n), 23)
  const readback = await readbackQuotes(seeded.courseId, sectionId)
  assert.ok(readback.perStock.every((s) => s.marketStatus === 'ok'))
})
