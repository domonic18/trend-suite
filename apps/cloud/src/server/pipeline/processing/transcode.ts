import 'server-only'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runFfmpeg } from './ffmpeg'
import { assetWorkDir } from './paths'
import { moveFile } from './frames'
import * as repo from './repo'
import { getMediaStore } from '../store'
import { ProcessingError, type ProcessingContext } from './runner'

/**
 * HLS 转码阶段（arch/05 §3.4 定案启用）：单码率 720p H.264/AAC、6s 分片 VOD。
 * 幂等：hls_path 已落且分片在盘即跳过——存量 ready 素材重跑（非 force）只补这一段。
 * 失败语义：retryable ProcessingError，队列退避重试；重试只补 HLS，不动已转块与帧。
 */

export async function transcodeStage(ctx: ProcessingContext): Promise<string> {
  const store = getMediaStore()
  const hlsRef = store.hlsRef(ctx.assetId)

  const existing = await repo.findAssetHlsPath(ctx.assetId)
  if (existing && (await hlsReady(store.hlsDir(ctx.assetId)))) return existing

  await ctx.onProgress?.({ step: 'transcode', progress: 76, message: '转码 HLS' })
  const workDir = join(assetWorkDir(ctx.assetId), 'hls')
  await rm(workDir, { recursive: true, force: true })
  await mkdir(workDir, { recursive: true })

  await runFfmpeg({
    args: [
      '-y',
      '-i',
      ctx.sourcePath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-vf',
      "scale=w=-2:h=720:force_original_aspect_ratio=decrease",
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-g',
      '48',
      '-keyint_min',
      '48',
      '-sc_threshold',
      '0',
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      join(workDir, 'seg_%05d.ts'),
      join(workDir, 'index.m3u8'),
    ],
    shouldCancel: ctx.shouldCancel,
  })

  await verifyHls(workDir)

  const targetDir = store.hlsDir(ctx.assetId)
  await mkdir(targetDir, { recursive: true })
  for (const name of await readdir(workDir)) {
    await moveFile(join(workDir, name), join(targetDir, name))
  }
  await rm(workDir, { recursive: true, force: true })

  await repo.setAssetHlsPath({ assetId: ctx.assetId, hlsPath: hlsRef })
  return hlsRef
}

/** 发布前校验（arch/05 §3.4）：playlist 有 ENDLIST、全部分片存在且非空。 */
export async function verifyHls(dir: string): Promise<void> {
  let playlist: string
  try {
    playlist = await readFile(join(dir, 'index.m3u8'), 'utf8')
  } catch {
    throw new ProcessingError('HLS 转码未产出 playlist', {
      retryable: true,
      code: 'transcode_failed',
    })
  }
  if (!playlist.includes('#EXT-X-ENDLIST')) {
    throw new ProcessingError('HLS playlist 缺少 ENDLIST（转码未完整收尾）', {
      retryable: true,
      code: 'transcode_failed',
    })
  }
  const names = (await readdir(dir)).filter((n) => n.endsWith('.ts'))
  if (names.length === 0) {
    throw new ProcessingError('HLS playlist 存在但没有分片', {
      retryable: true,
      code: 'transcode_failed',
    })
  }
  for (const name of names) {
    const info = await stat(join(dir, name)).catch(() => null)
    if (!info || info.size === 0) {
      throw new ProcessingError(`HLS 分片缺失或为空：${name}`, {
        retryable: true,
        code: 'transcode_failed',
      })
    }
  }
}

async function hlsReady(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir)
    return names.includes('index.m3u8') && names.some((n) => n.endsWith('.ts'))
  } catch {
    return false
  }
}
