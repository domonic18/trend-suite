import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { insertAsset } from '@/server/pipeline/repo'
import { runWorkerOnce } from '@/server/pipeline/jobs/worker'
import { approvePlan, savePlanInput } from './service'
import * as repo from './repo'

/**
 * 起草器端到端（worker 分派）：队列认领 → LLM 产物 → 目录/概念校验 → 回写草案。
 * fetch 打桩，不发真实请求。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

const OUTLINE_TEXT = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义'].join('\n')

/** LLM 产物：引用了目录外章节 n99、漏掉了 n3、概念重名、依赖边指向未收录概念、分节参数越界。 */
const LLM_OUTPUT = {
  matches: [
    { nodeId: 'n1', matchScore: 0.9 },
    { nodeId: 'n2', matchScore: 0.9 },
    { nodeId: 'n99', matchScore: 0.5 },
  ],
  concepts: [
    { name: '趋势', aliases: [], definition: '价格运行方向' },
    { name: '趋势', aliases: [], definition: '重复定义' },
  ],
  edges: [{ from: '趋势', to: '级别', kind: 'prerequisite' }],
  lessons: [
    {
      sectionId: 'n3',
      title: '趋势的定义',
      subLessonCount: 99,
      estimatedMinutes: 1,
      parallelSlot: 9,
    },
  ],
}

function stubFetch(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(LLM_OUTPUT) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

/** 第一次调用（代拟目录）返回结构化目录，第二次（综合起草）返回常规产物。 */
function stubFetchWithOutlineDraft(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? init.body : ''
    const payload = body.includes('目录设计助手')
      ? {
          sections: [
            { level: 1, title: '总论' },
            { level: 2, title: '什么是趋势' },
            { level: 3, title: '趋势的定义' },
          ],
        }
      : LLM_OUTPUT
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

test('worker 认领课程任务并回写草案四件套，目录外章节与重名概念进拒绝记录', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'a.mp4', expectedByteSize: 10 })
  await query(
    `UPDATE media_assets SET status = 'ready', source_path = '/tmp/a.mp4' WHERE id = $1`,
    [assetId],
  )
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: OUTLINE_TEXT,
    allowPartial: false,
  })
  assert.equal(job.status, 'queued')

  const restore = stubFetch()
  try {
    const handled = await runWorkerOnce('test-worker')
    assert.equal(handled, true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string; attempts: number }>(
    'SELECT status, attempts FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'succeeded')
  assert.equal(jobs[0]?.attempts, 1)

  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft)
  assert.equal(draft?.status, 'draft')
  assert.equal(draft?.origin, 'initial')
  assert.equal(draft?.version, 1)

  const content = draft!.skeleton as { nodes: { id: string; matchStatus: string }[] }
  // 骨架 = 目录全量节点（目录是下界，不是交集）
  assert.equal(content.nodes.length, 3)
  assert.equal(content.nodes[0]?.matchStatus, 'ok')
  // LLM 漏掉的目录节点保留且判为证据不足
  assert.equal(content.nodes[2]?.matchStatus, 'low_match')

  const violations = draft!.violations as { kind: string; subject: string }[]
  assert.ok(violations.some((v) => v.kind === 'outline_violation' && v.subject === 'n99'))
  assert.ok(violations.some((v) => v.kind === 'concept_conflict' && v.subject === '趋势'))

  const conceptMap = draft!.concept_map as { concepts: { name: string }[]; edges: unknown[] }
  assert.equal(conceptMap.concepts.length, 1)
  assert.equal(conceptMap.edges.length, 0)

  const glossary = draft!.glossary as { items: { term: string }[] }
  assert.equal(glossary.items.length, 1)

  const sectionPlan = draft!.section_plan as {
    lessons: { sectionId: string | null; subLessonCount: number; estimatedMinutes: number; parallelSlot: number }[]
  }
  assert.equal(sectionPlan.lessons.length, 1)
  assert.equal(sectionPlan.lessons[0]?.sectionId, 'n3')
  // 越界参数被钳到契约区间
  assert.equal(sectionPlan.lessons[0]?.subLessonCount, 20)
  // 没有出处可依时取模型的估值（不再有 5 分钟地板）
  assert.equal(sectionPlan.lessons[0]?.estimatedMinutes, 1)
  assert.equal(sectionPlan.lessons[0]?.parallelSlot, 8)

  const runs = await query<{ status: string; tokens_in: number | null }>(
    'SELECT status, tokens_in FROM ai_runs WHERE ref_id = $1',
    [course.id],
  )
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.status, 'succeeded')
  assert.ok(draft!.ai_run_id)
})

/**
 * 迭代 9 回归：沿用人工目录 + 素材有理解结果。
 *
 * 旧口径把「素材有理解结果」当成「智能规划」，提示词与代码走岔：
 * 模型被判不用给匹配度 → 匹配度全是 null → 每一行「无证据支撑 · 待裁决」→ 方案永远批不了。
 * 现在匹配度一律由出处推导，课时标题取教师原文，方案能批。
 */
const MANUAL_OUTLINE = [
  '第一篇 交易认知的反思与选择',
  '第一章 趋势的本质',
  '1. 趋势包含方向与能量',
  '2. 股票是周期加趋势',
].join('\n')

test('沿用人工目录：匹配度由出处推导、课时标题取教师原文，方案可批准', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-人工目录',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-manual',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: '讲义.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/x.mp4' WHERE id = $1`, [
    assetId,
  ])
  // 两个理解单元，各带一条讲解要点
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 0, 600000, '讲解内容', $4::jsonb, 0)`,
    [
      'su_m1',
      course.id,
      assetId,
      JSON.stringify({ teachingPoints: ['趋势包含明确方向与蕴藏能量'] }),
    ],
  )
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 600000, 1200000, '讲解内容', $4::jsonb, 1)`,
    ['su_m2', course.id, assetId, JSON.stringify({ teachingPoints: ['股票是周期加趋势'] })],
  )

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: MANUAL_OUTLINE,
    allowPartial: false,
  })

  // 模型给了匹配度、也改了小节标题——都不能盖过教师原文与出处
  const payload = {
    matches: [
      { nodeId: 'n1', matchScore: 0.9 },
      { nodeId: 'n2', matchScore: 0.9 },
      { nodeId: 'n3', matchScore: 0.9 },
      { nodeId: 'n4', matchScore: 0.9 },
    ],
    concepts: [{ name: '趋势', aliases: [], definition: '价格运行方向' }],
    edges: [],
    lessons: [
      {
        sectionId: 'n3',
        title: '趋势的方向与能量（模型自己改的名）',
        subLessonCount: 2,
        estimatedMinutes: 30,
        parallelSlot: 1,
        sourceUnitIds: ['su_m1'],
      },
      {
        sectionId: 'n4',
        title: '股票是周期加趋势',
        subLessonCount: 1,
        estimatedMinutes: 30,
        parallelSlot: 1,
        sourceUnitIds: ['su_m2'],
      },
    ],
  }
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)

    const jobs = await query<{ status: string; error_code: string | null }>(
      'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
      [job.id],
    )
    assert.equal(jobs[0]?.status, 'succeeded')

    const draft = await repo.findDraftPlan(course.id)
    assert.ok(draft)

    const content = draft!.skeleton as {
      nodes: { id: string; title: string; matchScore: number | null; matchStatus: string }[]
    }
    assert.equal(content.nodes.length, 4)
    // 每一行都有出处支撑，不再整页飘红
    for (const node of content.nodes) {
      assert.equal(node.matchStatus, 'ok', node.id)
      assert.equal(node.matchScore, 1, node.id)
    }

    const sectionPlan = draft!.section_plan as {
      lessons: { title: string; sourceUnitIds: string[]; estimatedMinutes: number }[]
    }
    assert.equal(sectionPlan.lessons.length, 2)
    // 课时标题是教师原文，模型改名不算数
    assert.deepEqual(
      sectionPlan.lessons.map((lesson) => lesson.title),
      ['趋势包含方向与能量', '股票是周期加趋势'],
    )
    // 估时按绑定单元的真实跨度，不是模型拍的值
    assert.equal(sectionPlan.lessons[0]?.estimatedMinutes, 10)
    assert.equal(sectionPlan.lessons[1]?.estimatedMinutes, 10)

    // 没有待裁决项 → 方案可批准
    const violations = (draft!.violations ?? []) as { resolved: boolean }[]
    assert.equal(violations.filter((violation) => !violation.resolved).length, 0)
    const approved = await approvePlan(teacher, course.id)
    assert.equal(approved.status, 'approved')
    // 批准会排生产任务：跑掉它，别把队列留给后面的用例
    await runWorkerOnce('test-worker')
  } finally {
    globalThis.fetch = original
  }
})

test('模型漏写 matchScore：不算结构错误，草案照常落库（缺省即「无证据支撑」）', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-漏匹配度',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-no-score',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'a.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/a.mp4' WHERE id = $1`, [
    assetId,
  ])
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: OUTLINE_TEXT,
    allowPartial: false,
  })

  // matches 里只有 nodeId，matchScore 整个键漏掉。
  const payload = {
    ...LLM_OUTPUT,
    matches: [{ nodeId: 'n1' }, { nodeId: 'n2' }],
  }
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    globalThis.fetch = original
  }

  const jobs = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'succeeded', '漏写匹配度不该把起草打失败')
  assert.equal(jobs[0]?.error_code, null)

  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft, '草案已落库')
})

/** 建课（避免直接依赖 content/service 的额外语义）。 */
async function createCourseFor(ownerId: string): Promise<{ id: string }> {
  const { createCourse } = await import('../service')
  return createCourse(ownerId, '起草课')
}
/**
 * 规划自检（迭代 8 PR#47）：自检不通过的方案不呈现给教师——
 * 带失败原因自动重规划，连续 3 次不过转人工，坏草案一行都不落。
 */

/** 目录代拟按调用次数依次返回不同版本（第一次坏、第二次好）。 */
function stubSelfCheckFetch(outlines: { sections: unknown[] }[], lessonUnitId: string): () => void {
  const original = globalThis.fetch
  let outlineCalls = 0
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? init.body : ''
    const payload = body.includes('目录设计助手')
      ? (outlines[Math.min(outlineCalls++, outlines.length - 1)] ?? outlines[0])
      : {
          matches: [],
          concepts: [{ name: '趋势', aliases: [], definition: '价格运行方向' }],
          edges: [],
          lessons: [
            {
              sectionId: 'n3',
              title: '趋势的方向性',
              subLessonCount: 2,
              estimatedMinutes: 9,
              parallelSlot: 1,
              sourceUnitIds: [lessonUnitId],
            },
          ],
        }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

/** 建一门带两个理解单元的课（3 条要点、20 分钟素材 → 规模上限 2 课时）。 */
async function courseWithUnits(
  username: string,
  unitPrefix: string,
): Promise<{
  id: string
  teacher: Awaited<ReturnType<typeof createAccount>>
  unitIds: [string, string]
}> {
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourseFor(teacher.id)
  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'f.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/f.mp4' WHERE id = $1`, [
    assetId,
  ])
  const unitIds: [string, string] = [`${unitPrefix}1`, `${unitPrefix}2`]
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 0, 600000, '讲解内容', $4::jsonb, 0)`,
    [
      unitIds[0],
      course.id,
      assetId,
      JSON.stringify({ teachingPoints: ['趋势有方向性', '趋势有持续性'] }),
    ],
  )
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 600000, 1200000, '讲解内容', $4::jsonb, 1)`,
    [unitIds[1], course.id, assetId, JSON.stringify({ teachingPoints: ['级别由时间尺度定义'] })],
  )
  return { id: course.id, teacher, unitIds }
}

test('智能规划：自检不通过自动重规划，第二版通过才落库', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-自检重规划',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const course = await courseWithUnits('laoshi-selfcheck-retry', 'su_r1_')

  const job = await savePlanInput(course.teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
    mode: 'smart',
  })

  const restore = stubSelfCheckFetch(
    [
      // 第一版：课时没出处且标题是空话 → 自检不通过
      {
        sections: [
          { level: 1, title: '趋势入门', sourceUnitIds: [] },
          { level: 2, title: '什么是趋势', sourceUnitIds: [] },
          { level: 3, title: '概述', sourceUnitIds: [] },
        ],
      },
      // 第二版：出处齐、标题是知识点 → 通过
      {
        sections: [
          { level: 1, title: '趋势入门', sourceUnitIds: [] },
          { level: 2, title: '什么是趋势', sourceUnitIds: [] },
          { level: 3, title: '趋势的方向性', sourceUnitIds: [course.unitIds[0]] },
          { level: 3, title: '趋势的级别', sourceUnitIds: [course.unitIds[1]] },
        ],
      },
    ],
    course.unitIds[0],
  )
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'succeeded')

  const reviews = await query<{ status: string; attempts: number; issues: unknown }>(
    'SELECT status, attempts, issues FROM plan_reviews WHERE course_id = $1 ORDER BY created_at',
    [course.id],
  )
  // 第一轮失败留痕，第二轮通过
  assert.equal(reviews.length, 2)
  assert.equal(reviews[0]?.status, 'fail')
  assert.equal(reviews[0]?.attempts, 1)
  assert.equal(reviews[1]?.status, 'pass')
  assert.equal(reviews[1]?.attempts, 2)

  // 通过的那版才落库
  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft)
  const outline = (await query<{ outline: unknown }>('SELECT outline FROM courses WHERE id = $1', [
    course.id,
  ]))[0]?.outline as { nodes: { title: string }[] }
  assert.equal(outline.nodes.length, 4)
  assert.equal(outline.nodes[0]?.title, '第一篇 趋势入门')
})

test('智能规划：连续 3 次自检不通过转人工，坏方案一行都不落', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-自检转人工',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const course = await courseWithUnits('laoshi-selfcheck-manual', 'su_m1_')

  const job = await savePlanInput(course.teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
    mode: 'smart',
  })

  const restore = stubSelfCheckFetch(
    [
      {
        sections: [
          { level: 1, title: '趋势入门', sourceUnitIds: [] },
          { level: 2, title: '什么是趋势', sourceUnitIds: [] },
          { level: 3, title: '概述', sourceUnitIds: [] },
        ],
      },
    ],
    course.unitIds[0],
  )
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'failed')
  assert.equal(jobs[0]?.error_code, 'plan_self_check_failed')

  const reviews = await query<{ status: string; attempts: number }>(
    'SELECT status, attempts FROM plan_reviews WHERE course_id = $1 ORDER BY created_at',
    [course.id],
  )
  assert.equal(reviews.length, 4, '三轮失败各留一条，第 3 轮额外留一条转人工')
  assert.equal(reviews.at(-1)?.status, 'manual')
  assert.equal(reviews.at(-1)?.attempts, 3)

  // 坏方案不落库：没有草案行，目录树也没有被改写
  assert.equal(await repo.findDraftPlan(course.id), null)
  const stored = await query<{ outline: unknown }>('SELECT outline FROM courses WHERE id = $1', [
    course.id,
  ])
  assert.equal(stored[0]?.outline, null)
})

/**
 * 智能规划（迭代 8）：规划输入换成「讲解要点」清单，目录由 Agent 重排，
 * 教师粘贴的原文留着不动；骨架的出处与覆盖率都从要点绑定推导。
 */
function stubSmartFetch(): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? init.body : ''
    const payload = body.includes('目录设计助手')
      ? {
          sections: [
            { level: 1, title: '趋势入门', sourceUnitIds: [] },
            { level: 2, title: '什么是趋势', sourceUnitIds: [] },
            { level: 3, title: '趋势的方向性', sourceUnitIds: ['su_a1'] },
            { level: 3, title: '趋势的级别', sourceUnitIds: ['su_a2'] },
          ],
        }
      : {
          matches: [],
          concepts: [{ name: '趋势', aliases: [], definition: '价格运行方向' }],
          edges: [],
          lessons: [
            {
              sectionId: null,
              title: '趋势的方向性',
              subLessonCount: 2,
              estimatedMinutes: 9,
              parallelSlot: 1,
              sourceUnitIds: ['su_a1'],
            },
          ],
        }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

test('智能规划：目录按要点重排、教师原文保留，出处绑进骨架', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-智能规划',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-smart',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'c.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/c.mp4' WHERE id = $1`, [
    assetId,
  ])
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 0, 600000, '讲解内容', $4::jsonb, 0)`,
    [
      'su_a1',
      course.id,
      assetId,
      JSON.stringify({ teachingPoints: ['趋势有方向性', '趋势有持续性'] }),
    ],
  )
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 600000, 1200000, '讲解内容', $4::jsonb, 1)`,
    [
      'su_a2',
      course.id,
      assetId,
      JSON.stringify({ teachingPoints: ['级别由时间尺度定义'] }),
    ],
  )

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '第一篇 总论\n第一章 什么是趋势',
    allowPartial: false,
    mode: 'smart',
  })
  assert.equal(job.status, 'queued')

  const restore = stubSmartFetch()
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'succeeded')
  assert.equal(jobs[0]?.error_code, null)

  // 智能规划重排了工作目录树，但教师粘贴的原文留着
  const stored = await query<{ outline: unknown; outline_text: string }>(
    'SELECT outline, outline_text FROM courses WHERE id = $1',
    [course.id],
  )
  assert.equal(stored[0]?.outline_text, '第一篇 总论\n第一章 什么是趋势')
  const outline = stored[0]?.outline as { nodes: { id: string; title: string }[] }
  assert.equal(outline.nodes.length, 4)
  assert.equal(outline.nodes[0]?.title, '第一篇 趋势入门')

  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft)
  const content = draft!.skeleton as {
    nodes: { title: string; matchStatus: string; sourceUnitIds: string[] }[]
  }
  assert.equal(content.nodes.length, 4)
  // 出处逐条绑定：有出处的课时判匹配
  assert.deepEqual(content.nodes[2]?.sourceUnitIds, ['su_a1'])
  assert.equal(content.nodes[2]?.matchStatus, 'ok')
  assert.deepEqual(content.nodes[3]?.sourceUnitIds, ['su_a2'])
  assert.equal(content.nodes[3]?.matchStatus, 'ok')
  // 无出处的篇与章按子节点覆盖比例判定：两个课时都有出处 → 满匹配
  assert.equal(content.nodes[0]?.matchStatus, 'ok')
  assert.equal(content.nodes[1]?.matchStatus, 'ok')

  // 分节计划的出处进课时，估时以绑定单元时长为准
  const sectionPlan = draft!.section_plan as {
    lessons: { title: string; sourceUnitIds: string[]; estimatedMinutes: number }[]
  }
  // 课时以目录为准：目录里两个课时节点就有两条课时
  assert.equal(sectionPlan.lessons.length, 2)
  assert.deepEqual(sectionPlan.lessons[0]?.sourceUnitIds, ['su_a1'])
  assert.equal(sectionPlan.lessons[0]?.estimatedMinutes, 10)
  assert.deepEqual(sectionPlan.lessons[1]?.sourceUnitIds, ['su_a2'])
  assert.equal(sectionPlan.lessons[1]?.estimatedMinutes, 10)
})

test('智能规划：课时数超出素材推导的上限时裁掉并留痕', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-超规模',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-oversize',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'e.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/e.mp4' WHERE id = $1`, [
    assetId,
  ])
  // 一个单元、2 条要点、跨度 10 分钟 → 规模上限 min(2 条要点, 1 课时) = 1
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, extra, chunk_index)
     VALUES ($1, $2, $3, 0, 600000, '讲解内容', $4::jsonb, 0)`,
    ['su_b1', course.id, assetId, JSON.stringify({ teachingPoints: ['要点甲', '要点乙'] })],
  )

  const original = globalThis.fetch
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? init.body : ''
    const payload = body.includes('目录设计助手')
      ? {
          sections: [
            { level: 1, title: '总论', sourceUnitIds: [] },
            { level: 2, title: '什么是趋势', sourceUnitIds: [] },
            { level: 3, title: '趋势的方向性', sourceUnitIds: ['su_b1'] },
            { level: 3, title: '趋势的级别', sourceUnitIds: ['su_b1'] },
            { level: 3, title: '趋势的延续', sourceUnitIds: ['su_b1'] },
          ],
        }
      : {
          matches: [],
          concepts: [],
          edges: [],
          lessons: [
            {
              sectionId: null,
              title: '趋势的方向性',
              subLessonCount: 1,
              estimatedMinutes: 10,
              parallelSlot: 1,
              sourceUnitIds: ['su_b1'],
            },
          ],
        }
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
    mode: 'smart',
  })

  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    globalThis.fetch = original
  }

  const jobs = await query<{ status: string }>('SELECT status FROM pipeline_jobs WHERE id = $1', [
    job.id,
  ])
  assert.equal(jobs[0]?.status, 'succeeded')

  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft)
  const content = draft!.skeleton as { nodes: { level: number }[] }
  const lessonNodes = content.nodes.filter((node) => node.level === 3)
  assert.equal(lessonNodes.length, 1, '超规模的课时被裁掉')

  const violations = draft!.violations as { kind: string; subject: string; reason: string }[]
  const scale = violations.find((violation) => violation.subject === '规划规模')
  assert.ok(scale, '裁剪要留痕')
  assert.equal(scale?.kind, 'outline_violation')
})

test('智能规划：所选素材没有理解结果时任务明确失败，让教师去重跑理解', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-未理解',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-not-understood',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)
  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'd.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/d.mp4' WHERE id = $1`, [
    assetId,
  ])

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
    mode: 'smart',
  })

  const restore = stubSmartFetch()
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  assert.equal(jobs[0]?.status, 'failed')
  assert.equal(jobs[0]?.error_code, 'material_not_understood')
})

test('教师留空目录时 Agent 代拟一版目录先验并回写，随后按该先验综合起草', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-代拟',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-outline',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'b.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/b.mp4' WHERE id = $1`, [
    assetId,
  ])
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )

  // 只交目标：目录留空 → 走 Agent 代拟路径
  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
  })
  assert.equal(job.status, 'queued')

  const stored = await query<{ outline: unknown; outline_text: string }>(
    'SELECT outline, outline_text FROM courses WHERE id = $1',
    [course.id],
  )
  assert.equal(stored[0]?.outline_text, '')

  const restore = stubFetchWithOutlineDraft()
  try {
    const handled = await runWorkerOnce('test-worker')
    assert.equal(handled, true)
  } finally {
    restore()
  }

  const jobs = await query<{ status: string }>('SELECT status FROM pipeline_jobs WHERE id = $1', [
    job.id,
  ])
  assert.equal(jobs[0]?.status, 'succeeded')

  // 代拟的目录先验已回写：文本与树同源
  const after = await query<{ outline: unknown; outline_text: string }>(
    'SELECT outline, outline_text FROM courses WHERE id = $1',
    [course.id],
  )
  assert.equal(
    after[0]?.outline_text,
    ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义'].join('\n'),
  )
  const outline = after[0]?.outline as { nodes: { id: string; level: number }[] }
  assert.equal(outline.nodes.length, 3)
  assert.equal(outline.nodes[0]?.level, 1)

  const draft = await repo.findDraftPlan(course.id)
  assert.ok(draft)
  const content = draft!.skeleton as { nodes: { title: string; matchStatus: string }[] }
  assert.equal(content.nodes.length, 3)
  assert.equal(content.nodes[0]?.title, '第一篇 总论')
  // 综合起草仍以代拟目录为下界：目录外章节进拒绝记录，目录内漏掉的判证据不足
  const violations = draft!.violations as { kind: string; subject: string }[]
  assert.ok(violations.some((v) => v.kind === 'outline_violation' && v.subject === 'n99'))

  // 两次模型调用都记账：代拟目录 + 综合起草
  const runs = await query<{ status: string }>(
    'SELECT status FROM ai_runs WHERE ref_id = $1 ORDER BY created_at',
    [course.id],
  )
  assert.equal(runs.length, 2)
  assert.ok(runs.every((run) => run.status === 'succeeded'))
})

test('目录代拟被 max_tokens 截断：任务回到队列可重试，失败调用的用量照样入台账', { skip }, async () => {
  const entry = await createModelEntry({
    name: '起草模型-截断',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-draft-truncated',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)
  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, createdBy: teacher.id, fileName: 'a.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/a.mp4' WHERE id = $1`, [
    assetId,
  ])

  const job = await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '',
    allowPartial: false,
  })

  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"sections":[{"level":1,"title":"总' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 800, completion_tokens: 12000 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch
  try {
    assert.equal(await runWorkerOnce('test-worker'), true)
  } finally {
    globalThis.fetch = original
  }

  const jobs = await query<{ status: string; error_code: string | null; attempts: number }>(
    'SELECT status, error_code, attempts FROM pipeline_jobs WHERE id = $1',
    [job.id],
  )
  // 截断可重试：任务退回 queued 等退避重投，而不是终态失败
  assert.equal(jobs[0]?.status, 'queued')
  assert.equal(jobs[0]?.error_code, 'llm_truncated')
  assert.equal(jobs[0]?.attempts, 1)

  const runs = await query<{ status: string; tokens_out: number | null }>(
    'SELECT status, tokens_out FROM ai_runs WHERE ref_id = $1',
    [course.id],
  )
  assert.equal(runs[0]?.status, 'failed')
  assert.equal(runs[0]?.tokens_out, 12000)

  const usage = await query<{ tokens_out: number }>(
    `SELECT tokens_out FROM ai_usage_events WHERE run_id IN (SELECT id FROM ai_runs WHERE ref_id = $1)`,
    [course.id],
  )
  assert.equal(usage[0]?.tokens_out, 12000)
})
