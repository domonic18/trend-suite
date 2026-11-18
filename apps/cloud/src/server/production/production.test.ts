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
import { findJobByCourse } from '@/server/pipeline/jobs/repo'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { HttpError } from '@/server/lib/http'
import { getProductionBoard, retryProductionSection } from './service'
import { claimNextStep, listSections, listTasks } from './repo'
import { startMockLlm, type MockLlm } from './mock-llm'
import { startMockQuotes, type MockQuotes } from '@/server/content/quotes/mock-quotes'

/**
 * 九步引擎验收（docs/plan 迭代 4 清单）：
 * ① 批准后自动起跑（9×N 预插 + job 入队 + 逐步推进）
 * ② 一节挂起：进度保留、原因可见、他节不受影响、重试可恢复
 * ④ 两课并行互不阻塞
 * ⑤ 库中无「部分产物」的节（对外只认 complete）
 * 另补：顺序强制（结构性挡住跑错序）。
 * 验收③（杀进程续跑）独立文件 crash.test.ts（真实 worker 进程）。
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
    name: '九步占位模型',
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
  assert.equal(tasks.length, sections.length * 9)
  assert.ok(tasks.every((t) => t.status === 'done'), '所有步 done')
}

test('验收① 批准即起跑：9×N 预插、job 入队、runWorkerOnce 后全部推进到位', { skip }, async () => {
  const { courseId } = await seedApprovedCourse('验收一课')

  const sections = await listSections(courseId)
  assert.equal(sections.length, 2)
  const tasks = await listTasks(courseId)
  assert.equal(tasks.length, 18)
  assert.ok(tasks.every((t) => t.status === 'pending'), '预插全 pending')
  const job = await findJobByCourse({ courseId, kind: 'production_run' })
  assert.equal(job?.status, 'queued')

  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(courseId)

  const board = await getProductionBoard(
    { id: 'x', username: 'x', role: 'admin' } as never,
    courseId,
  )
  assert.ok(board.sections.every((s) => s.status === 'complete' && s.products === 9))
  // agent 步产物经工具写入 checkpoint（第一层校验后的占位产物落库）
  const runCounts = await query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM ai_runs WHERE ref_type = 'production_task'`,
  )
  assert.ok(Number(runCounts[0]?.count ?? 0) >= 12, '九步 agent 调用有账本')
})

test('验收② 一节挂起：进度保留、原因可见、他节不受影响；重试后追平', { skip }, async () => {
  const { teacherId, username, courseId, sectionIds } = await seedApprovedCourse('验收二课')
  mock.failSection = sectionIds[0] ?? null
  const teacher = { id: teacherId, username, role: 'producer' } as never
  try {
    assert.equal(await runWorkerOnce(workerId()), true)
    const board = await getProductionBoard(teacher, courseId)
    const suspended = board.sections.find((s) => s.sectionId === sectionIds[0])
    const other = board.sections.find((s) => s.sectionId === sectionIds[1])
    assert.ok(suspended && other)
    assert.equal(suspended.status, 'pending', '挂起节对外仍是 pending（绝不部分落库）')
    assert.equal(suspended.products, 0, '第 1 步失败即挂起，产物计数为 0')
    const firstTask = suspended.tasks.find((t) => t.step === 1)
    assert.equal(firstTask?.status, 'pending_manual')
    assert.ok(firstTask?.lastError, '失败原因可见')
    assert.equal(other.status, 'complete', '他节不受影响')
  } finally {
    // 断言失败也要重置注入，避免污染后续测试的课程。
    mock.failSection = null
  }
  await retryProductionSection(teacher, courseId, sectionIds[0] ?? '')
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(courseId)
})

test('验收④ 两课并行：双 job 各自完整跑完互不污染', { skip }, async () => {
  const a = await seedApprovedCourse('并行课一')
  const b = await seedApprovedCourse('并行课二')

  const handled = await Promise.all([runWorkerOnce(`${workerId()}-a`), runWorkerOnce(`${workerId()}-b`)])
  assert.deepEqual(handled, [true, true])
  await assertCourseDone(a.courseId)
  await assertCourseDone(b.courseId)

  const rows = await query<{ course_id: string; n: string }>(
    `SELECT course_id, COUNT(*)::int AS n FROM production_tasks
     WHERE course_id IN ($1, $2) GROUP BY course_id`,
    [a.courseId, b.courseId],
  )
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => Number(r.n) === 18))
})

test('验收⑤ 终态无部分产物：跑完的课程无 pending 节，complete 节必配 9 个 done 步', { skip }, async () => {
  // 顺序课尚未起跑（pending 属正常）；只断言已跑完的课程。
  const finished = await query<{ id: string }>(
    `SELECT DISTINCT course_id AS id FROM production_tasks`,
  )
  const finishedIds = finished.map((r) => r.id)
  assert.ok(finishedIds.length >= 4)
  const pendingLeft = await query<{ course_id: string }>(
    `SELECT DISTINCT course_id FROM sections WHERE status = 'pending' AND course_id = ANY($1::text[])`,
    [finishedIds],
  )
  assert.deepEqual(pendingLeft, [], '跑完的课程残留 pending 节')
  const partial = await query<{ course_id: string; section_id: string }>(
    `SELECT s.course_id, s.section_id FROM sections s
     JOIN production_tasks t ON t.course_id = s.course_id AND t.section_id = s.section_id
     WHERE s.status = 'complete'
     GROUP BY s.course_id, s.section_id
     HAVING COUNT(*) FILTER (WHERE t.status = 'done') <> COUNT(*) OR COUNT(*) <> 9`,
  )
  assert.deepEqual(partial, [], '存在 complete 但步不齐的部分产物节')
})

test('权限：admin 兼具 producer 权限可重试他课挂起节', { skip }, async () => {
  const { courseId, sectionIds } = await seedApprovedCourse('权限课')
  const admin = await createAccount({
    username: `guanliyuan-${randomBytes(4).toString('hex')}`,
    password: 'correct-horse',
    role: 'admin',
  })
  // admin 非课程归属人，但兼具 producer 权限：过了权限门，落到业务检查
  // （该课尚未起跑、无挂起/失败步 → 409 production_not_retryable，而非 403）。
  await assert.rejects(
    () => retryProductionSection(admin, courseId, sectionIds[0] ?? ''),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'production_not_retryable',
  )
  // 消费 seedApprovedCourse 批准时入队的 job，避免占住队列影响后续用例的 runWorkerOnce。
  assert.equal(await runWorkerOnce(workerId()), true)
})

test('顺序强制：更小步未 done 时认领被结构性挡住', { skip }, async () => {
  const { courseId, sectionIds } = await seedApprovedCourse('顺序课')
  const sectionId = sectionIds[0] ?? ''
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(courseId)

  // 只回退第 2、3 步（第 1 步仍 done）：认领第 2 步
  await query(
    `UPDATE production_tasks SET status = 'pending', attempts = 0
     WHERE course_id = $1 AND section_id = $2 AND step IN (2, 3)`,
    [courseId, sectionId],
  )
  const claimed = await claimNextStep(courseId, sectionId)
  assert.equal(claimed?.step, 2)

  // 第 2 步卡 running：第 3 步不可认领（前序未 done），且它自己也不再被认领
  const claimedAgain = await claimNextStep(courseId, sectionId)
  assert.equal(claimedAgain, null)
})
