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
import { getPlanFor, savePlanInput } from './service'

/**
 * Agent 执行轨迹：方案页 Agent 面板的数据来源。
 * 跑一次真实起草（fetch 打桩），断言轨迹能还原「读素材 → 代拟目录 → 综合起草 → 校验 → 等确认」。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

before(async () => {
  if (url) await resetTestDatabase()
})

const LLM_OUTPUT = {
  matches: [{ nodeId: 'n1', matchScore: 0.9 }],
  concepts: [{ name: '趋势', aliases: ['走势'], definition: '价格运行方向' }],
  edges: [],
  lessons: [
    {
      sectionId: 'n3',
      title: '趋势的定义',
      subLessonCount: 2,
      estimatedMinutes: 30,
      parallelSlot: 1,
    },
  ],
}

/** 第一次调用（代拟目录）返回结构化目录，第二次（综合起草）返回常规产物。 */
function stubFetch(): () => void {
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
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

async function createCourseFor(ownerId: string): Promise<{ id: string }> {
  const { createCourse } = await import('../service')
  return createCourse(ownerId, '轨迹课')
}

test('方案接口带出 Agent 执行轨迹：步骤、模型调用、对话与产物', { skip }, async () => {
  const entry = await createModelEntry({
    name: '轨迹模型',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-trace',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, fileName: 'c.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/c.mp4' WHERE id = $1`, [
    assetId,
  ])
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )

  // 教师留空目录 → Agent 代拟目录先验（两次模型调用：outline + draft）。
  await savePlanInput(teacher, course.id, { goal: '学会看盘', outlineText: '', allowPartial: false })
  const restore = stubFetch()
  try {
    assert.equal(await runWorkerOnce('trace-worker'), true)
  } finally {
    restore()
  }

  const result = await getPlanFor(teacher, course.id)
  const trace = result.trace
  assert.ok(trace)
  assert.equal(trace.status, 'done')

  const byKey = new Map(trace.steps.map((step) => [step.key, step]))
  assert.equal(byKey.get('corpus')?.status, 'done')
  assert.equal(byKey.get('outline')?.label, 'Agent 代拟目录')
  assert.equal(byKey.get('outline')?.status, 'done')
  assert.equal(byKey.get('draft')?.status, 'done')
  assert.equal(byKey.get('validate')?.status, 'done')
  assert.equal(byKey.get('confirm')?.status, 'waiting')

  // 两次模型调用按阶段归类：目录代拟 + 综合起草。
  assert.equal(trace.calls.length, 2)
  assert.deepEqual(
    trace.calls.map((call) => call.label),
    ['目录代拟', '综合起草'],
  )
  assert.ok(trace.calls.every((call) => call.status === 'succeeded' && call.tokensOut === 50))

  // 对话流：教师目标 + Agent 的过程叙述。
  assert.equal(trace.messages[0]?.role, 'user')
  assert.equal(trace.messages[0]?.text, '学会看盘')
  assert.ok(trace.messages.some((message) => message.text.includes('已读取')))
  assert.ok(trace.messages.some((message) => message.text.includes('方案草案已生成')))

  // 产物：方案文件 + 语料目录。
  assert.ok(trace.artifacts.some((artifact) => artifact.path === 'plan/v1.md'))
  assert.ok(trace.artifacts.some((artifact) => artifact.path === 'units/'))
})

test('人工目录时轨迹记「目录先验（人工目录）」，且不产生代拟调用', { skip }, async () => {
  const entry = await createModelEntry({
    name: '轨迹模型-人工目录',
    purposes: ['llm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-model',
    baseUrl: 'https://llm.example.com',
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'content.curriculum', primaryModelId: entry.id, backupModelId: null })

  const teacher = await createAccount({
    username: 'laoshi-trace-manual',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourseFor(teacher.id)

  const assetId = newId('mediaAsset')
  await insertAsset({ id: assetId, courseId: course.id, fileName: 'd.mp4', expectedByteSize: 10 })
  await query(`UPDATE media_assets SET status = 'ready', source_path = '/tmp/d.mp4' WHERE id = $1`, [
    assetId,
  ])
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, partial)
     VALUES ($1, $2, 0, 0, 5000, '趋势是价格运行的方向', false)`,
    [newId('transcriptSegment'), assetId],
  )

  await savePlanInput(teacher, course.id, {
    goal: '学会看盘',
    outlineText: '第一篇 总论\n第一章 什么是趋势',
    allowPartial: false,
  })
  const restore = stubFetch()
  try {
    assert.equal(await runWorkerOnce('trace-worker-2'), true)
  } finally {
    restore()
  }

  const trace = (await getPlanFor(teacher, course.id)).trace
  assert.ok(trace)
  const outlineStep = trace.steps.find((step) => step.key === 'outline')
  assert.equal(outlineStep?.label, '目录先验（人工目录）')
  assert.equal(outlineStep?.status, 'done')
  // 人工目录不触发代拟调用，只剩一次综合起草。
  assert.equal(trace.calls.length, 1)
  assert.equal(trace.calls[0]?.label, '综合起草')
})
