import { before, after, test } from 'node:test'
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
import { runWorkerOnce, workerId } from '@/server/pipeline/jobs/worker'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { listSections, listTasks } from './repo'
import { startMockLlm, mockUnitIdFor, type MockLlm } from './mock-llm'
import { startMockQuotes, type MockQuotes } from '@/server/content/quotes/mock-quotes'
import * as widgetsRepo from '@/server/content/widgets/repo'

/**
 * 课件步的引擎接线（迭代 7，验收①②）：
 * ① 一节内出现可交互课件：第 5 步产出回放课件、第 7 步产出其余课件并落库；
 * ② 人为让一条断言不成立 → 该节不入库，界面能列出失败项（回灌 ≤3 → 人工待办）；
 * ③ 同一份课件重复生成 → 数值完全一致（生成器可重放，见 contracts 的生成器用例）。
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
    name: '课件占位模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: mock.url,
    apiKey: 'sk-test-key',
  })
  for (const task of [
    'content.case_stocks',
    'content.figure_spec',
    'content.widget_spec',
    'content.section_draft',
    'rubric_review',
  ]) {
    await updateTaskBinding({ task, primaryModelId: entry.id, backupModelId: null })
  }
})

const OUTLINE_TEXT = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义'].join('\n')

async function seedApprovedCourse(name: string): Promise<{ courseId: string; sectionId: string }> {
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
     VALUES ($1, $2, $3, 20000, 50000, '讲师在周线图上逐笔画出趋势线。', '讲师手绘趋势线')`,
    [mockUnitIdFor(course.id), course.id, assetId],
  )
  // 步骤 4 keyframe 落帧：secHint 30s ±2s 容差内要有现成帧（测试环境无源文件，补抽必失败）。
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path)
     VALUES ($1, $2, 30000, 'frames/seed/30000.jpg')`,
    [newId('mediaFrame'), assetId],
  )

  const sections = await listSections(course.id)
  return { courseId: course.id, sectionId: sections[0]?.section_id ?? '1-1' }
}

test('验收① 课件步真实化：回放课件与其余课件都落库，断言证明记录齐全', { skip }, async () => {
  const { courseId, sectionId } = await seedApprovedCourse('课件引擎课')
  assert.equal(await runWorkerOnce(workerId()), true)

  const widgets = await widgetsRepo.listWidgets(courseId, sectionId)
  assert.equal(widgets.length, 4, '第 5 步 1 份回放 + 第 7 步 3 份其余课件')
  const replay = widgets.find((widget) => widget.type === 'bar-replay-decision')
  assert.ok(replay, '回放课件在库')
  assert.equal(replay?.code, '600519')

  const proofs = await widgetsRepo.listValidations(widgets.map((widget) => widget.id))
  assert.ok(proofs.length >= widgets.length, '每份课件都有程序证明记录')
  assert.ok(proofs.every((proof) => proof.status === 'pass'))

  const tasks = await listTasks(courseId)
  assert.ok(tasks.every((task) => task.status === 'done'), '九步全 done')
})

test('验收② 断言不成立 → 该节不入库，失败项可见（回灌 ≤3 → 人工待办）', { skip }, async () => {
  const { courseId, sectionId } = await seedApprovedCourse('断言不过课')
  // 概念表里没有「均线」：termsInConcepts 必判不过。
  mock.step7Product = {
    widgets: [
      {
        type: 'mcq-quiz',
        citations: ['__MOCK_UNIT__'],
        assertions: {},
        question: '均线是什么？',
        options: [
          { id: 'a', label: '平均成本' },
          { id: 'b', label: '成交量' },
        ],
        answerId: 'a',
        conceptRefs: ['均线'],
      },
    ],
  }
  try {
    assert.equal(await runWorkerOnce(workerId()), true)
  } finally {
    mock.step7Product = null
  }

  const tasks = await listTasks(courseId)
  const step7 = tasks.find((task) => task.section_id === sectionId && task.step === 7)
  assert.equal(step7?.status, 'pending_manual', '回灌超上限转人工待办')
  assert.match(step7?.last_error ?? '', /termsInConcepts/, '失败项在拒绝原因里可见')
  assert.match(step7?.last_error ?? '', /课件复检拒绝/)

  const widgets = await widgetsRepo.listWidgets(courseId, sectionId)
  assert.equal(
    widgets.filter((widget) => widget.type !== 'bar-replay-decision').length,
    0,
    '判不过的课件一行不落',
  )
  const sections = await listSections(courseId)
  assert.notEqual(sections[0]?.status, 'complete', '整节不入库')
})

test('回放行情不可用 → 降级跳过（不产课件、步照常 done）', { skip }, async () => {
  const { courseId, sectionId } = await seedApprovedCourse('行情降级课')
  // 行情源不可用 **且** 缓存里没有 bars（quote_bars 按 code 跨课共享，故显式清空）。
  quotesMock.failAll = true
  await query(`DELETE FROM quote_bars`)
  try {
    assert.equal(await runWorkerOnce(workerId()), true)
  } finally {
    quotesMock.failAll = false
  }

  const tasks = await listTasks(courseId)
  const step5 = tasks.find((task) => task.section_id === sectionId && task.step === 5)
  assert.equal(step5?.status, 'done', '行情不可用不挂起（与迭代 5 同一口径）')
  const widgets = await widgetsRepo.listWidgets(courseId, sectionId)
  assert.equal(widgets.filter((widget) => widget.type === 'bar-replay-decision').length, 0)
})
