import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { DSL_VERSION } from '@trend-suite/contracts'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { approvePlan } from '@/server/content/plans/service'
import { buildSkeleton, parseOutline } from '@/server/content/plans/outline'
import { glossaryOf, validateConceptMap } from '@/server/content/plans/concepts'
import * as plansRepo from '@/server/content/plans/repo'
import { runWorkerOnce, workerId } from '@/server/pipeline/jobs/worker'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { getSectionContent } from '@/server/content/textbook/section-content'
import * as textbookRepo from '@/server/content/textbook/repo'
import { retryProductionSection } from './service'
import { listSections, listTasks } from './repo'
import { startMockLlm, mockUnitIdFor, type MockLlm } from './mock-llm'
import { startMockQuotes, type MockQuotes } from '@/server/content/quotes/mock-quotes'

/**
 * 正文步（验收④）：概念表外术语的正文被复检拦截并说明原因（回灌喂回），
 * 修正后追平落库（body_status='draft'）；content 视图内联证据单元与图示，
 * 事实锚点可回溯（验收②的服务端半边，UI 渲染在浏览器）。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'
process.env.MEDIA_UPLOAD_SECRET = 'test-secret-for-figure-frame-signing'

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
    name: '正文占位模型',
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

/** 概念表外术语的正文：其余全部合规，唯独 :::sidenote 用了未收录的「均线」。 */
const BAD_DRAFT = [
  '# 1. 趋势的定义',
  '',
  '趋势是价格运行的方向：高点与低点依次抬升为多头，依次下移为空头。这是本节最核心的概念，讲师在原片 [[unit:__UNIT__|原片演示]] 中逐笔画出了这条主线，判断依据是高低点序列而不是主观感受。',
  '',
  ':::sidenote title=均线',
  '均价的连线，常被初学者当作趋势本身——这正是本节要纠正的误用。',
  ':::',
  '',
  '实例：[[stock:600519|贵州茅台]] 2023 年周线重心逐级上移，回调不破前低，是教科书式的多头趋势样本，讲解见 [[unit:__UNIT__|原片对照]]。',
  '',
  '检查清单：周期是否一致；高低点是否依次抬升；量能是否配合；级别之间是否互相印证，四个问题逐一过。',
  '',
  '常见误用：把日内波动当趋势反转，或在两个级别信号冲突时强行入场——级别混看是初学者最常踩的坑，务必先定级别再看方向。',
].join('\n')

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

  const assetId = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'seed.mp4', 'sources/x/source', 'ready', 120)`,
    [assetId, course.id],
  )
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, visual_desc)
     VALUES ($1, $2, $3, 20000, 50000, '讲师在周线图上逐笔画出趋势线，讲解高低点抬升的判断依据。', '讲师手绘趋势线')`,
    [mockUnitIdFor(course.id), course.id, assetId],
  )
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path) VALUES ($1, $2, 30000, 'frames/seed/30000.jpg')`,
    [newId('mediaFrame'), assetId],
  )

  const sections = await listSections(course.id)
  return { teacherId: teacher.id, username, courseId: course.id, sectionIds: sections.map((s) => s.section_id) }
}

test('验收④ 概念表外术语被拦：拒绝原因可读、回灌追平后正文落库', { skip }, async () => {
  const { teacherId, username, courseId, sectionIds } = await seedApprovedCourse('正文复检课')
  const teacher = { id: teacherId, username, role: 'producer' } as never
  const unitId = mockUnitIdFor(courseId)

  mock.step6Product = {
    markdown: BAD_DRAFT.replaceAll('__UNIT__', unitId),
  }
  try {
    assert.equal(await runWorkerOnce(workerId()), true)

    // 步骤 6 被复检拒绝：worker 单轮内连烧 3 次回灌预算（MAX_ATTEMPTS=3）后挂起，原因落 last_error
    const tasks = await listTasks(courseId)
    const draftTasks = tasks.filter((t) => t.step === 6)
    assert.ok(draftTasks.length >= 1)
    for (const task of draftTasks) {
      assert.equal(task.status, 'pending_manual', '回灌预算烧满挂起，绝不静默丢弃')
      assert.equal(task.attempts, 3)
      assert.ok(task.last_error?.includes('term_not_in_concepts'), `拒绝原因带错误码：${task.last_error}`)
      assert.ok(task.last_error?.includes('均线'), '拒绝原因带术语词')
      assert.ok(task.last_error?.includes('最接近的已收录术语'), '拒绝原因带最近似术语建议')
    }
    const sectionRow = await query<{ body_status: string; body: string | null }>(
      `SELECT body_status, body FROM sections WHERE course_id = $1 AND section_id = $2`,
      [courseId, sectionIds[0]],
    )
    assert.equal(sectionRow[0]?.body_status, 'none', '被拒正文绝不部分落库')
    assert.equal(sectionRow[0]?.body, null)
  } finally {
    // 注入不泄给后续用例（断言失败也要还原）。
    mock.step6Product = null
  }

  // 修正（finally 已换回默认合规草稿）→ 重试追平
  await retryProductionSection(teacher, courseId, sectionIds[0] ?? '')
  assert.equal(await runWorkerOnce(workerId()), true)
  // step6Product 对全部节生效——只重试第一节，追平断言也只看本节任务
  const afterTasks = (await listTasks(courseId)).filter((t) => t.section_id === sectionIds[0])
  assert.ok(afterTasks.every((t) => t.status === 'done'), '重试后本节全部追平')
  const done = await query<{ body_status: string; dsl_version: number | null }>(
    `SELECT body_status, dsl_version FROM sections WHERE course_id = $1 AND section_id = $2`,
    [courseId, sectionIds[0]],
  )
  assert.equal(done[0]?.body_status, 'draft')
  assert.equal(done[0]?.dsl_version, DSL_VERSION)
})

test('content 视图：证据单元内联、图示带签名地址、案例股可回溯（验收②服务端半边）', { skip }, async () => {
  const { courseId, sectionIds } = await seedApprovedCourse('正文视图课')
  assert.equal(await runWorkerOnce(workerId()), true)
  const teacher = { id: 'x', username: 'x', role: 'admin' } as never
  const { content } = await getSectionContent(teacher, courseId, sectionIds[0] ?? '')
  const unitId = mockUnitIdFor(courseId)

  assert.equal(content.bodyStatus, 'draft')
  assert.ok(content.body?.includes('趋势的定义'))
  assert.equal(content.dslVersion, DSL_VERSION)

  // [[unit:]] 锚解析出的单元：时间窗与转写可回溯
  assert.ok(content.units.some((u) => u.id === unitId && u.startMs === 20000 && u.endMs === 50000))
  assert.ok(content.units.every((u) => u.playable === false), '素材未产出 HLS → 不可播标志')

  // 三路图示落库形态：generated 因未绑模型被剔除，只剩 keyframe + diagram
  assert.equal(content.figures.length, 2)
  const keyframe = content.figures.find((f) => f.kind === 'keyframe')
  assert.ok(keyframe?.url?.includes('sig='), '帧地址带短时签名')
  assert.ok(keyframe?.sec === 30)
  const diagram = content.figures.find((f) => f.kind === 'diagram')
  assert.ok(diagram?.svg?.includes('<svg'))

  // 个股锚可回溯到本节案例股清单
  assert.ok(content.caseStocks.some((stock) => stock.code === '600519'))
})

test('textbookRepo：正文与拒绝态的存取语义', { skip }, async () => {
  const { courseId, sectionIds } = await seedApprovedCourse('正文存取课')
  const sectionId = sectionIds[0] ?? ''
  const before = await textbookRepo.findSectionContent(courseId, sectionId)
  assert.equal(before?.body_status, 'none')
  await textbookRepo.saveSectionBody({ courseId, sectionId, dslVersion: 1, body: '# 1. 趋势的定义' })
  const draft = await textbookRepo.findSectionContent(courseId, sectionId)
  assert.equal(draft?.body_status, 'draft')
  assert.equal(draft?.dsl_version, 1)
  await textbookRepo.saveSectionBodyRejected({ courseId, sectionId, body: '# 1. 趋势的定义', dslVersion: 1 })
  const rejected = await textbookRepo.findSectionContent(courseId, sectionId)
  assert.equal(rejected?.body_status, 'rejected')
})
