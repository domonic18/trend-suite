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
import {
  getProductionBoard,
  getProductionStream,
  resumeProduction,
  retryProductionSection,
  stopProduction,
} from './service'
import { claimNextStep, listRunningTasks, listSections, listTasks } from './repo'
import { startMockLlm, mockUnitIdFor, type MockLlm } from './mock-llm'
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

  // 步骤 4/6 真实产物依赖素材证据单元：种子一个 ready 素材 + 一条 source unit。
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

  // 步骤 4 keyframe 落帧：secHint 30s ±2s 容差内要有现成帧（测试环境源文件不存在，ffmpeg 补抽必失败）。
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path)
     VALUES ($1, $2, 30000, 'frames/seed/30000.jpg')`,
    [newId('mediaFrame'), assetId],
  )

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

test('输出预算按步下发：出站请求的 max_tokens 是该步预算，不是通道默认', { skip }, async () => {
  const { courseId } = await seedApprovedCourse('预算一课')
  const before = mock.calls.length
  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(courseId)

  const bodies = mock.calls
    .slice(before)
    .map((call) => call.body as { max_tokens?: unknown })
    .filter((body) => typeof body.max_tokens === 'number')
  assert.ok(bodies.length > 0, '九步 agent 步有出站调用')
  assert.ok(
    bodies.every((body) => (body.max_tokens as number) >= 8_000),
    '出站 max_tokens 不得落回 4K 默认（思考吃光即截断）',
  )
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

// ---------------------------------------------------------------- 停止制作（教师端需求 T21）

/** 轮询等待条件成立（跑批时序：等 worker 真的动起来）。 */
async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('等待条件超时')
}

test('停止制作：步边界中止、成果保留、继续不重跑已完成的步', { skip }, async () => {
  const { teacherId, username, courseId } = await seedApprovedCourse('停止课')
  const teacher = { id: teacherId, username, role: 'producer' } as never
  mock.delayMs = 250
  try {
    const running = runWorkerOnce(workerId())
    await waitFor(async () => (await listRunningTasks(courseId)).length > 0)
    const stop = await stopProduction(teacher, courseId)
    assert.equal(stop.stopped, true)
    assert.ok(stop.sectionId, '停止点落在具体某一节')
    assert.ok(stop.step && stop.step >= 1 && stop.step <= 9, '停止点落在具体某一步')
    await running
  } finally {
    mock.delayMs = 0
  }

  const job = await findJobByCourse({ courseId, kind: 'production_run' })
  assert.equal(job?.status, 'canceled', '停止后 job 记 canceled（不是失败）')

  const tasks = await listTasks(courseId)
  const doneBefore = tasks
    .filter((task) => task.status === 'done')
    .map((task) => `${task.section_id}:${task.step}:${task.attempts}`)
    .sort()
  assert.ok(doneBefore.length > 0, '已完成的步成果保留')

  const board = await getProductionBoard(teacher, courseId)
  assert.ok(board.stop, '看板回报停止点')
  assert.equal(board.stop?.stopped, true)

  await resumeProduction(teacher, courseId)
  const job2 = await findJobByCourse({ courseId, kind: 'production_run' })
  assert.equal(job2?.status, 'queued', '继续制作重新入队')
  assert.notEqual(job2?.id, job?.id, '终态 job 不复活，新建一行')

  assert.equal(await runWorkerOnce(workerId()), true)
  await assertCourseDone(courseId)

  const tasks2 = await listTasks(courseId)
  const doneAfter = tasks2
    .filter((task) => task.status === 'done')
    .map((task) => `${task.section_id}:${task.step}:${task.attempts}`)
    .sort()
  // 已完成的步 attempts 不变 → 继续时没有重跑它们。
  const kept = doneBefore.filter((entry) => doneAfter.includes(entry))
  assert.equal(kept.length, doneBefore.length, '继续不重跑已完成的步')
})

test('停止与继续：排队中可停止（尚未开跑）、继续可再次入队、在跑时重复继续被挡', { skip }, async () => {
  const { teacherId, username, courseId } = await seedApprovedCourse('停止二课')
  const teacher = { id: teacherId, username, role: 'producer' } as never
  // 批准后 job 还在排队：停止 = 取消排队（还没开跑，无产物可保）。
  const stop = await stopProduction(teacher, courseId)
  assert.equal(stop.stopped, true)
  assert.equal(stop.step, null, '尚未开跑，停止点没有步')
  const stoppedJob = await findJobByCourse({ courseId, kind: 'production_run' })
  assert.equal(stoppedJob?.status, 'canceled')

  await resumeProduction(teacher, courseId)
  const job = await findJobByCourse({ courseId, kind: 'production_run' })
  assert.equal(job?.status, 'queued')
  assert.notEqual(job?.id, stoppedJob?.id, '终态 job 不复活，新建一行')
  await assert.rejects(
    () => resumeProduction(teacher, courseId),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'production_already_running',
  )
  // 消费入队的 job，避免占住队列影响后续用例。
  assert.equal(await runWorkerOnce(workerId()), true)
  // 全部跑完后 job 终态：再停止被挡（没有在跑的制作任务可停）。
  await assert.rejects(
    () => stopProduction(teacher, courseId),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'production_not_running',
  )
})

test('继续制作：worker 还在步边界收尾时继续——撤销停止请求，同一个 job 接着跑', { skip }, async () => {
  const { teacherId, username, courseId } = await seedApprovedCourse('继续一课')
  const teacher = { id: teacherId, username, role: 'producer' } as never
  mock.delayMs = 250
  try {
    const running = runWorkerOnce(workerId())
    await waitFor(async () => (await listRunningTasks(courseId)).length > 0)
    await stopProduction(teacher, courseId)
    const mid = await findJobByCourse({ courseId, kind: 'production_run' })
    assert.equal(mid?.status, 'running', '停止请求下达后 job 仍在跑')
    assert.equal(mid?.cancel_requested, true, '停止请求已挂在 job 上')

    await resumeProduction(teacher, courseId)
    const after = await findJobByCourse({ courseId, kind: 'production_run' })
    // 两种落点都算继续成功：同一个 job 撤销停止继续跑，或 worker 先一步停掉后新建一行。
    // 绝不接受「同一个 job 仍挂着 cancel_requested」——那等于点了继续什么都没发生。
    if (after?.id === mid?.id) {
      assert.equal(after.cancel_requested, false, '停止请求已撤销')
      assert.equal(after.status, 'running')
    } else {
      assert.equal(after?.status, 'queued', 'worker 先停掉时新建一行排队')
    }

    await running
  } finally {
    mock.delayMs = 0
  }
  await runWorkerOnce(workerId())
  await assertCourseDone(courseId)
})

test('事件流：步事件按序留痕、游标增量续读、tool 卡只记事实', { skip }, async () => {
  const { courseId } = await seedApprovedCourse('事件课')
  const admin = { id: 'x', username: 'x', role: 'admin' } as never
  assert.equal(await runWorkerOnce(workerId()), true)

  const stream = await getProductionStream(admin, courseId, null)
  assert.ok(stream.events.length > 0, '有事件')
  const stepEvents = stream.events.filter((event) => event.kind === 'step')
  // 两节 × 九步，每步一条开始、一条完成。
  assert.ok(stepEvents.filter((event) => event.status === 'running').length >= 18)
  assert.ok(stepEvents.filter((event) => event.status === 'done').length >= 18)
  assert.ok(
    stepEvents.every((event) => event.sectionId && event.sectionTitle),
    '步事件带着节，可定位到哪一节',
  )

  const toolEvents = stream.events.filter((event) => event.kind === 'tool')
  assert.ok(toolEvents.length > 0, '模型调用记成工具卡')
  assert.ok(toolEvents.every((event) => event.model), '工具卡记模型')
  assert.ok(toolEvents.some((event) => (event.tokensOut ?? 0) > 0), '工具卡记 token')

  assert.ok(stream.cursor, '带游标')
  const again = await getProductionStream(admin, courseId, stream.cursor)
  assert.equal(again.events.length, 0, '游标之后没有新事件（增量续读）')
})
