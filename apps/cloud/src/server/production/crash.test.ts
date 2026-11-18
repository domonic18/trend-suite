import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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
import { listSections, listTasks } from './repo'
import { startMockLlm, type MockLlm } from './mock-llm'

/**
 * 验收③ 杀进程续跑：独立 worker 进程跑到一半 SIGKILL，重启后
 * 断点续跑——done 步不重跑（updated_at 不变），running 步被重置后补完。
 * WORKER_RECLAIM_STALE_SECS=2 注入缩小的心跳超时，避免等真实 120 秒。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

const CREDENTIAL_KEY = randomBytes(32).toString('base64url')
process.env.CREDENTIAL_ENCRYPTION_KEY = CREDENTIAL_KEY
process.env.MEDIA_STORAGE = 'local'

const mock: MockLlm = await startMockLlm()
const cloudRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')

let child: ChildProcess | null = null
let workerOutput = ''
after(async () => {
  if (child?.pid && child.exitCode === null) child.kill('SIGKILL')
  await mock.close()
})

before(async () => {
  if (url) await resetTestDatabase()
  const entry = await createModelEntry({
    name: '崩溃续跑模型',
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

async function spawnWorker(): Promise<ChildProcess> {
  workerOutput = ''
  const proc = spawn('node', ['--conditions=react-server', '--import', 'tsx', 'src/worker.ts'], {
    cwd: cloudRoot,
    env: {
      ...process.env,
      DATABASE_URL: url ?? '',
      CREDENTIAL_ENCRYPTION_KEY: CREDENTIAL_KEY,
      MEDIA_STORAGE: 'local',
      APP_ROLE: 'worker',
      WORKER_RECLAIM_STALE_SECS: '2',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout?.on('data', (chunk: Buffer) => {
    workerOutput += chunk.toString('utf8')
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    workerOutput += chunk.toString('utf8')
  })
  return proc
}

async function waitFor(
  label: string,
  cond: () => Promise<boolean>,
  timeoutMs = 60_000,
  stepMs = 300,
): Promise<void> {
  const started = Date.now()
  for (;;) {
    if (await cond()) return
    if (Date.now() - started > timeoutMs) {
      throw new Error(`等待超时（${label}）；worker 输出尾部：${workerOutput.slice(-2000)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}

test('验收③ 杀进程续跑：SIGKILL 后重启，done 步不重跑、其余补完', { skip }, async () => {
  const teacher = await createAccount({ username: `crash-${randomBytes(4).toString('hex')}`, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, '崩溃课')
  const outline = parseOutline(OUTLINE_TEXT)
  const { skeleton } = buildSkeleton(
    outline,
    outline.nodes.map((node) => ({ nodeId: node.id, matchScore: 0.9 })),
  )
  const normalized = validateConceptMap({
    concepts: [{ name: '趋势', aliases: [], definition: '价格运行方向' }],
    edges: [],
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

  // 第一段：慢速 mock 拉开窗口，跑到中途 SIGKILL
  mock.delayMs = 250
  child = await spawnWorker()
  await waitFor('出现已完成的步', async () => {
    const rows = await query<{ id: string }>(
      `SELECT id FROM production_tasks WHERE course_id = $1 AND status = 'done'`, [course.id],
    )
    const jobs = await query<{ status: string }>(`SELECT status FROM pipeline_jobs WHERE course_id = $1`, [course.id])
    return rows.length >= 2 && jobs.some((j) => j.status === 'running')
  })
  const snapshot = await query<{ id: string; updated_at: Date }>(
    `SELECT id, updated_at FROM production_tasks WHERE course_id = $1 AND status = 'done'`, [course.id],
  )
  assert.ok(snapshot.length >= 2)
  const killed = child
  killed.kill('SIGKILL')
  await new Promise<void>((resolve) => {
    killed.on('exit', () => resolve())
    setTimeout(resolve, 2000)
  })
  assert.notEqual(killed.exitCode, 0, '进程确实被杀')

  // 第二段：心跳冷却过后重启（回收阈值 2s），恢复正常速度
  await new Promise((resolve) => setTimeout(resolve, 2600))
  mock.delayMs = 0
  child = await spawnWorker()
  await waitFor('全部节完成', async () => {
    const sections = await listSections(course.id)
    return sections.length > 0 && sections.every((s) => s.status === 'complete')
  })

  // done 步没有重跑：快照里的 updated_at 保持原值
  const afterRows = await query<{ id: string; status: string; updated_at: Date }>(
    `SELECT id, status, updated_at FROM production_tasks WHERE course_id = $1`, [course.id],
  )
  const tasks = await listTasks(course.id)
  assert.ok(tasks.every((t) => t.status === 'done'), '十八步全部 done')
  for (const shot of snapshot) {
    const row = afterRows.find((r) => r.id === shot.id)
    assert.ok(row, '崩溃前 done 步仍在')
    assert.equal(row?.status, 'done')
    assert.equal(row?.updated_at.toISOString(), shot.updated_at.toISOString(), `崩溃前完成的步 ${shot.id} 没有被重跑`)
  }

  child.kill('SIGKILL')
})
