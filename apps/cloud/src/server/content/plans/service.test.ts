import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { createAccount } from '@/server/accounts/service'
import { query, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { HttpError } from '@/server/lib/http'
import { insertAsset } from '@/server/pipeline/repo'
import { createCourse } from '../service'
import { buildSkeleton, parseOutline } from './outline'
import { glossaryOf, validateConceptMap } from './concepts'
import * as repo from './repo'
import { approvePlan, getPlanFor, listConceptsFor, rejectPlan, savePlanInput, tweakPlan } from './service'

/**
 * 方案状态机用例（对齐迭代 3 验收清单）：
 * 提交→起草占位、批准锁定、拒绝留痕、微调同步、目录外剔除、重名拒绝、未就绪拦截、权限。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

const OUTLINE_TEXT = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义'].join('\n')

before(async () => {
  if (url) await resetTestDatabase()
})

async function seedReadyAsset(courseId: string): Promise<string> {
  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId, fileName: 'lecture.mp4', expectedByteSize: 1024 })
  await query(
    `UPDATE media_assets SET status = 'ready', source_path = '/tmp/x.mp4', duration_s = 600 WHERE id = $1`,
    [assetId],
  )
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )
  return assetId
}

type DraftContent = {
  skeleton: unknown
  conceptMap: unknown
  glossary: unknown
  sectionPlan: unknown
  violations: unknown
}

/** 造一份「无未决项」的草案内容：骨架全 ok、两个概念、无拒绝记录。 */
function draftContent(): DraftContent {
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
  return {
    skeleton,
    conceptMap: normalized.conceptMap,
    glossary: glossaryOf(normalized.conceptMap),
    sectionPlan: {
      lessons: [
        {
          id: 'l1',
          sectionId: outline.nodes[2]!.id,
          title: '趋势的定义',
          subLessonCount: 3,
          estimatedMinutes: 18,
          parallelSlot: 1,
        },
      ],
    },
    violations: [],
  }
}

async function insertDraft(courseId: string, ownerId: string): Promise<string> {
  const id = newId('plan')
  await repo.insertPlan({
    id,
    courseId,
    version: await repo.nextPlanVersion(courseId),
    status: 'draft',
    origin: 'initial',
    createdBy: ownerId,
    ...draftContent(),
  })
  return id
}

test('提交目标与目录：素材未就绪不可起草，就绪后入队并落目标', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-1',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课一')

  // 没有素材 → 不可起草
  await assert.rejects(
    () => savePlanInput(teacher, course.id, { goal: '学会看盘', outlineText: OUTLINE_TEXT, allowPartial: false }),
    (err: unknown) => err instanceof HttpError && err.status === 409,
  )

  // 素材未就绪 → 仍不可起草
  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, fileName: 'a.mp4', expectedByteSize: 10 })
  await assert.rejects(
    () => savePlanInput(teacher, course.id, { goal: '学会看盘', outlineText: OUTLINE_TEXT, allowPartial: false }),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'plan_not_draftable',
  )

  await seedReadyAsset(course.id)
  await query(`UPDATE media_assets SET status = 'ready' WHERE course_id = $1`, [course.id])
  const job = await savePlanInput(teacher, course.id, { goal: '学会看盘', outlineText: OUTLINE_TEXT, allowPartial: false })
  assert.equal(job.status, 'queued')
  assert.equal(job.courseId, course.id)

  const input = await repo.findCoursePlanInput(course.id)
  assert.equal(input?.goal, '学会看盘')
  assert.equal(input?.outline_text, OUTLINE_TEXT)
  assert.ok(input?.outline)
})

test('批准：锁定基准版并把概念落库；无草案再批 400', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-2',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课二')
  await insertDraft(course.id, teacher.id)

  const approved = await approvePlan(teacher, course.id)
  assert.equal(approved.status, 'approved')
  assert.equal(approved.version, 1)

  const concepts = await listConceptsFor(teacher, course.id)
  assert.equal(concepts.items.length, 2)
  assert.equal(concepts.edges.length, 1)

  // 幂等：没有草案可批
  await assert.rejects(
    () => approvePlan(teacher, course.id),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('批准：证据不足的分节与拒绝记录都要挡住（服务端门禁）', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-3',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课三')
  const outline = parseOutline(OUTLINE_TEXT)
  const { skeleton } = buildSkeleton(outline, [{ nodeId: outline.nodes[0]!.id, matchScore: 0.2 }])
  const content = draftContent()
  await repo.insertPlan({
    id: newId('plan'),
    courseId: course.id,
    version: 1,
    status: 'draft',
    origin: 'initial',
    createdBy: teacher.id,
    ...content,
    skeleton,
  })

  await assert.rejects(
    () => approvePlan(teacher, course.id),
    (err: unknown) =>
      err instanceof HttpError && err.status === 409 && err.code === 'plan_unresolved',
  )
})

test('打回：旧草案转 rejected，新草案版本 +1 并带上教师意见', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-4',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课四')
  const draftId = await insertDraft(course.id, teacher.id)

  const before = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_runs')
  const next = await rejectPlan(teacher, course.id, { feedback: '第 1 章太粗，拆细一点' })
  assert.equal(next.version, 2)
  assert.equal(next.status, 'draft')
  assert.equal(next.origin, 'revision')

  const old = await repo.findPlanById(draftId)
  assert.equal(old?.status, 'rejected')

  const after = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_runs')
  // 打回不重跑素材理解：不新增模型调用台账
  assert.equal(after[0]?.count, before[0]?.count)
})

test('微调：结构化即时生效，版本 +1 且不调模型', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-5',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课五')
  await seedReadyAsset(course.id)
  // 目录来自教师提交的目标与目录（微调要同步目录树）
  await savePlanInput(teacher, course.id, { goal: '学会看盘', outlineText: OUTLINE_TEXT, allowPartial: false })
  await insertDraft(course.id, teacher.id)

  const before = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_runs')
  const tweaked = await tweakPlan(teacher, course.id, {
    op: 'set_granularity',
    lessonId: 'l1',
    subLessonCount: 5,
  })
  assert.equal(tweaked.version, 2)
  assert.equal(tweaked.origin, 'tweak')
  assert.equal(tweaked.sectionPlan.lessons[0]?.subLessonCount, 5)

  const after = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM ai_runs')
  assert.equal(after[0]?.count, before[0]?.count)

  // 别名撞名 → 409
  await assert.rejects(
    () =>
      tweakPlan(teacher, course.id, {
        op: 'add_alias',
        conceptId: tweaked.conceptMap.concepts[0]!.id,
        alias: '级别',
      }),
    (err: unknown) => err instanceof HttpError && err.status === 409,
  )
})

test('概念落库：同课程重名由数据库唯一约束兜底', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-6',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '方案课六')
  const row = (id: string) => ({
    id,
    courseId: course.id,
    name: '趋势',
    aliases: [] as string[],
    definition: null,
  })

  await assert.rejects(
    () =>
      withTransaction(async (tx) => {
        await repo.insertConcepts([row(newId('concept'))], tx)
        await repo.insertConcepts([row(newId('concept'))], tx)
      }),
    (err: unknown) => (err as { code?: string }).code === '23505',
  )
})

test('权限：非课程所属教师不能写，运营只读', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-plan-7',
    password: 'correct-horse',
    role: 'producer',
  })
  const other = await createAccount({
    username: 'laoshi-plan-7b',
    password: 'correct-horse',
    role: 'producer',
  })
  const ops = await createAccount({
    username: 'yunying-plan-7',
    password: 'correct-horse',
    role: 'operator',
  })
  const course = await createCourse(teacher.id, '方案课七')
  await insertDraft(course.id, teacher.id)

  await assert.rejects(
    () => savePlanInput(other, course.id, { goal: 'x', outlineText: OUTLINE_TEXT, allowPartial: false }),
    (err: unknown) => err instanceof HttpError && err.status === 403,
  )
  await assert.rejects(
    () => approvePlan(other, course.id),
    (err: unknown) => err instanceof HttpError && err.status === 403,
  )
  await assert.rejects(
    () => approvePlan(ops, course.id),
    (err: unknown) => err instanceof HttpError && err.status === 403,
  )
  // 运营只读：看得到方案
  const view = await getPlanFor(ops, course.id)
  assert.ok(view.plan)
})
