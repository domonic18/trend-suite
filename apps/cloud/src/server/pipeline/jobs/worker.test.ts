import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { createModelEntry, updateTaskBinding } from '@/server/models/service'
import { rerunUnderstand } from '../processing/service'
import { runWorkerOnce } from './worker'

/**
 * 重跑理解任务（迭代 8）：存量素材没有理解结果时，教师端点「重跑理解」
 * → 入队 understand_rerun → worker 只跑理解阶段 → 产出教学要点。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'
const mediaRoot = mkdtempSync(join(tmpdir(), 'understand-rerun-'))
process.env.MEDIA_LOCAL_DIR = mediaRoot

const mock: { server: Server; url: string } = {
  server: undefined as unknown as Server,
  url: '',
}

before(async () => {
  if (url) await resetTestDatabase()
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      const payload = {
        units: [
          {
            startMs: 500,
            endMs: 3500,
            text: '讲师讲解本段要点。',
            visualDesc: null,
            chartType: '无',
            teachingPoints: ['先定级别', '再看方向'],
          },
        ],
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(payload) } }],
          usage: { prompt_tokens: 200, completion_tokens: 60 },
        }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  mock.server = server
  mock.url = `http://127.0.0.1:${port}`
})

after(async () => {
  mock.server.closeAllConnections()
  await new Promise<void>((resolve) => mock.server.close(() => resolve()))
})

async function seedReadyAsset(name: string): Promise<{
  user: { id: string; username: string; role: 'producer'; displayName: string | null }
  assetId: string
}> {
  const username = `lijie-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const assetId = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'seed.mp4', $3, 'ready', 12)`,
    [assetId, course.id, join(mediaRoot, `${assetId}.mp4`)],
  )
  await query(
    `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, chunk_index)
     VALUES ($1, $2, 0, 0, 4000, '开场：什么是趋势', 0)`,
    [newId('transcriptSegment'), assetId],
  )
  const framePath = join(mediaRoot, `${assetId}-1500.jpg`)
  writeFileSync(framePath, Buffer.from(`frame-${randomBytes(8).toString('hex')}`))
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path) VALUES ($1, $2, 1500, $3)`,
    [newId('mediaFrame'), assetId, framePath],
  )
  return {
    user: {
      id: teacher.id,
      username: teacher.username,
      role: teacher.role as 'producer',
      displayName: teacher.displayName,
    },
    assetId,
  }
}

test('重跑理解：入队 understand_rerun，worker 跑完理解阶段产出要点', { skip }, async () => {
  const entry = await createModelEntry({
    name: '重跑理解模型',
    purposes: ['vlm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-vlm',
    baseUrl: mock.url,
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'vision.describe', primaryModelId: entry.id, backupModelId: null })

  const { user, assetId } = await seedReadyAsset('重跑理解课')
  const { jobId } = await rerunUnderstand(user, assetId)

  const queued = await query<{ status: string; kind: string }>(
    'SELECT status, kind FROM pipeline_jobs WHERE id = $1',
    [jobId],
  )
  assert.equal(queued[0]?.kind, 'understand_rerun')
  assert.equal(queued[0]?.status, 'queued')

  assert.equal(await runWorkerOnce('test-worker'), true)

  const done = await query<{ status: string; error_code: string | null }>(
    'SELECT status, error_code FROM pipeline_jobs WHERE id = $1',
    [jobId],
  )
  assert.equal(done[0]?.status, 'succeeded')
  assert.equal(done[0]?.error_code, null)

  const units = await query<{ extra: { teachingPoints?: string[] } }>(
    'SELECT extra FROM source_units WHERE asset_id = $1',
    [assetId],
  )
  assert.equal(units.length, 1)
  assert.deepEqual(units[0]?.extra.teachingPoints, ['先定级别', '再看方向'])

  // 素材本来就绪：跑完理解要回到 done，不能把步进条永远停在「理解」。
  const asset = await query<{ process_step: string; process_progress: string; status: string }>(
    'SELECT process_step, process_progress, status FROM media_assets WHERE id = $1',
    [assetId],
  )
  assert.equal(asset[0]?.process_step, 'done')
  assert.equal(Number(asset[0]?.process_progress), 100)
  assert.equal(asset[0]?.status, 'ready')
})

test('重跑理解：素材未就绪时拒绝入队', { skip }, async () => {
  const { user, assetId } = await seedReadyAsset('未就绪课')
  await query(`UPDATE media_assets SET status = 'uploaded' WHERE id = $1`, [assetId])
  await assert.rejects(() => rerunUnderstand(user, assetId))
})
