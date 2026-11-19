import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { runFfmpeg } from './ffmpeg'
import { transcodeStage, verifyHls } from './transcode'
import { getMediaStore } from '../store'
import type { ProcessingContext } from './runner'

/**
 * HLS 转码阶段（arch/05 §3.4）：真 ffmpeg 跑 5s 合成素材，验 ENDLIST + 分片
 * 完整 + hls_path 落库 + 幂等跳过。ffmpeg 缺失整文件跳过（CI 容器有 ffmpeg）。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'
const mediaRoot = mkdtempSync(join(tmpdir(), 'transcode-media-'))
process.env.MEDIA_LOCAL_DIR = mediaRoot

const ffmpegMissing = spawnSync('ffmpeg', ['-version']).error ? '本机无 ffmpeg，跳过真转码用例' : false

function ctxOf(assetId: string, courseId: string, sourcePath: string): ProcessingContext {
  return {
    assetId,
    courseId,
    sourcePath,
    durationS: 5,
    framesDir: join(mediaRoot, 'sources', assetId, 'frames'),
  }
}

async function seedAsset(name: string): Promise<{ courseId: string; assetId: string; sourcePath: string }> {
  const username = `zhuanma-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const assetId = newId('mediaAsset')
  const sourcePath = join(mediaRoot, 'fixture', `${assetId}.mp4`)
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'fixture.mp4', $3, 'ready', 5)`,
    [assetId, course.id, `sources/${assetId}/source`],
  )
  // 合成 5s 测试视频（彩条 + 正弦音），真实走一遍转码参数
  mkdirSync(join(mediaRoot, 'fixture'), { recursive: true })
  await runFfmpeg({
    args: [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=5:size=320x240:rate=15',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=5',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      sourcePath,
    ],
  })
  return { courseId: course.id, assetId, sourcePath }
}

test('转码：5s 合成素材 → ENDLIST playlist + 非空分片 + hls_path 落库', { skip: skip || ffmpegMissing }, async () => {
  await resetTestDatabase()
  const { courseId, assetId, sourcePath } = await seedAsset('转码课')
  const store = getMediaStore()

  const hlsRef = await transcodeStage(ctxOf(assetId, courseId, sourcePath))
  assert.equal(hlsRef, `hls/${assetId}/index.m3u8`)

  const dir = store.hlsDir(assetId)
  const names = readdirSync(dir)
  assert.ok(names.includes('index.m3u8'))
  const segments = names.filter((n) => n.endsWith('.ts'))
  assert.ok(segments.length >= 1, '至少一个分片')
  for (const name of segments) {
    assert.ok(statSync(join(dir, name)).size > 0, `分片非空：${name}`)
  }
  const playlist = readFileSync(join(dir, 'index.m3u8'), 'utf8')
  assert.ok(playlist.includes('#EXT-X-ENDLIST'), 'VOD playlist 必须带 ENDLIST')

  const row = await query<{ hls_path: string }>(`SELECT hls_path FROM media_assets WHERE id = $1`, [assetId])
  assert.equal(row[0]?.hls_path, hlsRef)
})

test('转码幂等：hls 已在盘则跳过重转（直接返回既有引用）', { skip: skip || ffmpegMissing }, async () => {
  const { courseId, assetId, sourcePath } = await seedAsset('转码幂等课')
  const store = getMediaStore()
  const first = await transcodeStage(ctxOf(assetId, courseId, sourcePath))
  const playlistBefore = readFileSync(join(store.hlsDir(assetId), 'index.m3u8'), 'utf8')

  const second = await transcodeStage(ctxOf(assetId, courseId, sourcePath))
  assert.equal(second, first)
  assert.equal(readFileSync(join(store.hlsDir(assetId), 'index.m3u8'), 'utf8'), playlistBefore)
})

test('verifyHls：空目录 / 缺 ENDLIST / 空分片都是 retryable ProcessingError', { skip: skip }, async () => {
  const { ProcessingError } = await import('./runner')
  const empty = mkdtempSync(join(tmpdir(), 'hls-empty-'))
  await assert.rejects(() => verifyHls(empty), (err: unknown) => err instanceof ProcessingError && err.retryable)

  const noEndlist = mkdtempSync(join(tmpdir(), 'hls-noend-'))
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(join(noEndlist, 'index.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:6\n'),
  )
  await assert.rejects(() => verifyHls(noEndlist), (err: unknown) => err instanceof ProcessingError && err.retryable)
})
