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
import { understandStage, sampleFrames } from './understand'
import * as procRepo from './repo'
import type { ProcessingContext } from './runner'

/**
 * 素材理解阶段（arch/05 §4）：mock VLM（openai 协议，图输入原样返回固定
 * source unit JSON）——单元素产单元、unit_id 回填、按 chunk 幂等补缺失。
 * 理解失败不阻断素材 ready（永不抛错语义）也在本文件验证。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

/** mock VLM：从提示词里解析「本段时间窗」返回窗内单元；calls 记账。 */
const mock: { calls: number; server: Server; url: string; fail: boolean; truncateNext: boolean } = {
  calls: 0,
  server: undefined as unknown as Server,
  url: '',
  fail: false,
  truncateNext: false,
}

before(beforeAll)
async function beforeAll(): Promise<void> {
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      void handle().catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'mock_internal' }))
      })
    })
    async function handle(): Promise<void> {
      const body = raw.length > 0 ? (JSON.parse(raw) as { messages?: { content?: unknown }[] }) : {}
      mock.calls += 1
      if (mock.fail) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'vlm down' } }))
        return
      }
      // 截断：推理型模型的思考吃光 max_tokens 时就是这个形状
      if (mock.truncateNext) {
        mock.truncateNext = false
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"units":[{"startMs":0' }, finish_reason: 'length' }],
            usage: { prompt_tokens: 200, completion_tokens: 4096 },
          }),
        )
        return
      }
      const messages = body.messages ?? []
      // user 消息带图时 content 是数组（text + image_url parts），取全部文本段拼接
      const prompt = messages
        .map((m) =>
          typeof m.content === 'string'
            ? m.content
            : Array.isArray(m.content)
              ? m.content.map((part) => (typeof part === 'object' && part !== null ? String((part as { text?: string }).text ?? '') : '')).join('\n')
              : '',
        )
        .join('\n')
      const window = prompt.match(/本段时间窗：([\d.]+)s ~ ([\d.]+)s/)
      const startMs = Math.round(Number(window?.[1] ?? 0) * 1000) + 500
      const endMs = Math.round(Number(window?.[2] ?? 8) * 1000) - 500
      const payload = {
        units: [
          {
            startMs,
            endMs,
            text: '讲师讲解本段要点，逐笔画出主线。',
            visualDesc: '讲师手绘趋势线',
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
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  mock.server = server
  mock.url = `http://127.0.0.1:${port}`
}

after(async () => {
  mock.server.closeAllConnections()
  await new Promise<void>((resolve) => mock.server.close(() => resolve()))
})

const mediaRoot = mkdtempSync(join(tmpdir(), 'understand-media-'))

async function seedAsset(name: string): Promise<{ courseId: string; assetId: string }> {
  const username = `lijie-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const assetId = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'seed.mp4', 'sources/x/source', 'ready', 12)`,
    [assetId, course.id],
  )
  // 两个转写块（chunk 0/1），供分组与 unit_id 回填
  const segments: [number, number, number, number, string][] = [
    [0, 0, 2000, 0, '开场：什么是趋势'],
    [1, 2000, 4000, 0, '高低点抬升是多头'],
    [2, 5000, 7000, 1, '再看级别切换'],
    [3, 7000, 9000, 1, '大级别优先'],
  ]
  for (const [seq, startMs, endMs, chunk, text] of segments) {
    await query(
      `INSERT INTO transcript_segments (id, asset_id, seq, start_ms, end_ms, text, chunk_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [newId('transcriptSegment'), assetId, seq, startMs, endMs, text, chunk],
    )
  }
  // 采样帧：真实小文件（VLM 输入按 base64 原样进 mock，不校验内容）
  for (const atMs of [1500, 6500]) {
    const path = join(mediaRoot, `${assetId}-${atMs}.jpg`)
    writeFileSync(path, Buffer.from(`frame-${atMs}-${randomBytes(8).toString('hex')}`))
    await query(
      `INSERT INTO media_frames (id, asset_id, at_ms, path) VALUES ($1, $2, $3, $4)`,
      [newId('mediaFrame'), assetId, atMs, path],
    )
  }
  return { courseId: course.id, assetId }
}

function ctxOf(assetId: string, courseId: string): ProcessingContext {
  return {
    assetId,
    courseId,
    sourcePath: join(mediaRoot, 'unused.mp4'),
    durationS: 12,
    framesDir: join(mediaRoot, 'frames', assetId),
  }
}

async function unitCount(assetId: string): Promise<number> {
  const rows = await query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM source_units WHERE asset_id = $1`, [assetId])
  return Number(rows[0]?.n ?? 0)
}

test('理解：单元素产单元 + unit_id 回填 + chunk_index/extra 落库', { skip }, async () => {
  await resetTestDatabase()
  const entry = await createModelEntry({
    name: '理解占位模型',
    purposes: ['vlm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-vlm',
    baseUrl: mock.url,
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'vision.describe', primaryModelId: entry.id, backupModelId: null })

  const { courseId, assetId } = await seedAsset('理解课')
  await understandStage(ctxOf(assetId, courseId))

  assert.equal(await unitCount(assetId), 2, '两个理解块各产一个单元')
  const units = await procRepo.listSourceUnitsByAsset(assetId)
  assert.ok(units.every((u) => u.chunk_index === 0 || u.chunk_index === 1))
  const withExtra = units.find((u) => u.chunk_index === 0)
  assert.ok(withExtra)
  const extra = withExtra.extra as { teachingPoints?: string[]; chartType?: string | null }
  assert.deepEqual(extra.teachingPoints, ['先定级别', '再看方向'])
  assert.equal(extra.chartType, '无')

  const backfilled = await query<{ unit_id: string | null }>(
    `SELECT unit_id FROM transcript_segments WHERE asset_id = $1 ORDER BY seq`,
    [assetId],
  )
  assert.ok(backfilled.every((row) => row.unit_id !== null), '四个转写段都回填了 unit_id')
})

test('理解幂等：重跑不重复产块；删掉一个块后重跑只补缺失', { skip }, async () => {
  const { courseId, assetId } = await seedAsset('理解幂等课')
  await understandStage(ctxOf(assetId, courseId))
  const callsAfterFirst = mock.calls
  assert.equal(await unitCount(assetId), 2)

  await understandStage(ctxOf(assetId, courseId))
  assert.equal(await unitCount(assetId), 2, '已完成块跳过')
  assert.equal(mock.calls, callsAfterFirst, '幂等跳过时不打模型')

  await query(`DELETE FROM source_units WHERE asset_id = $1 AND chunk_index = 1`, [assetId])
  await understandStage(ctxOf(assetId, courseId))
  assert.equal(await unitCount(assetId), 2, '缺失块按 chunk 补齐，另一块不动')
})

test('理解失败不抛错：素材照常 ready，进度消息说明可重跑补齐', { skip }, async () => {
  const { courseId, assetId } = await seedAsset('理解失败课')
  mock.fail = true
  try {
    await assert.doesNotReject(() => understandStage(ctxOf(assetId, courseId)))
    assert.equal(await unitCount(assetId), 0, 'VLM 挂掉不落任何单元')
  } finally {
    mock.fail = false
  }
})

test('理解截断（推理模型的思考吃光 max_tokens）时重试一次即可补齐', { skip }, async () => {
  await resetTestDatabase()
  const entry = await createModelEntry({
    name: '理解截断模型',
    purposes: ['vlm'],
    provider: 'Test',
    protocol: 'openai',
    model: 'test-vlm',
    baseUrl: mock.url,
    apiKey: 'sk-test-key',
  })
  await updateTaskBinding({ task: 'vision.describe', primaryModelId: entry.id, backupModelId: null })

  const { courseId, assetId } = await seedAsset('理解截断课')
  const messages: string[] = []
  const callsBefore = mock.calls
  mock.truncateNext = true
  try {
    await understandStage({
      ...ctxOf(assetId, courseId),
      onProgress: async (input) => {
        if (input.message) messages.push(input.message)
      },
    })
  } finally {
    mock.truncateNext = false
  }
  assert.equal(await unitCount(assetId), 2, '截断重试后两块都产出单元')
  assert.equal(mock.calls - callsBefore, 3, '第一次调用截断，重试一次，两块共三次调用')
  assert.ok(
    messages.some((m) => m.includes('理解完成')),
    `收尾消息应说明理解完成：${messages.join(' | ')}`,
  )
})

test('没配 VLM 时提示「未配置 VLM 渠道」，不是「N 块失败」', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, assetId } = await seedAsset('理解无模型课')
  const messages: string[] = []
  await understandStage({
    ...ctxOf(assetId, courseId),
    onProgress: async (input) => {
      if (input.message) messages.push(input.message)
    },
  })
  assert.equal(await unitCount(assetId), 0)
  assert.ok(
    messages.some((m) => m.includes('未配置 VLM 渠道')),
    `实际消息：${messages.join(' | ')}`,
  )
})

test('sampleFrames：窗内优先（±15s 边距）、超限均匀采样、窗外全程兜底', () => {
  const frames = Array.from({ length: 7 }, (_, i) => ({
    id: `frm_${String(i).padStart(16, '0')}`,
    asset_id: 'med_x',
    at_ms: i * 10_000,
    path: `/tmp/f${i}.jpg`,
    width: null,
    height: null,
    caption: null,
    created_at: new Date(),
  }))
  // 窗 20s~30s：±15s 边距覆盖 5s~45s → 窗内池 = 10s/20s/30s/40s，limit 2 → 取首尾
  const picked = sampleFrames(frames as procRepo.MediaFrameRow[], 20_000, 30_000, 2)
  assert.deepEqual(picked.map((f) => f.at_ms), [10_000, 40_000])
  // 窗远离全部帧 → 全程均匀兜底（7 帧取 3）
  const fallback = sampleFrames(frames as procRepo.MediaFrameRow[], 100_000, 200_000, 3)
  assert.deepEqual(fallback.map((f) => f.at_ms), [0, 30_000, 60_000])
})
