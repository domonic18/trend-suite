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
import { savePlanInput } from './service'
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
  await insertAsset({ id: assetId, courseId: course.id, fileName: 'a.mp4', expectedByteSize: 10 })
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
  assert.equal(sectionPlan.lessons[0]?.estimatedMinutes, 5)
  assert.equal(sectionPlan.lessons[0]?.parallelSlot, 8)

  const runs = await query<{ status: string; tokens_in: number | null }>(
    'SELECT status, tokens_in FROM ai_runs WHERE ref_id = $1',
    [course.id],
  )
  assert.equal(runs.length, 1)
  assert.equal(runs[0]?.status, 'succeeded')
  assert.ok(draft!.ai_run_id)
})

/** 建课（避免直接依赖 content/service 的额外语义）。 */
async function createCourseFor(ownerId: string): Promise<{ id: string }> {
  const { createCourse } = await import('../service')
  return createCourse(ownerId, '起草课')
}
