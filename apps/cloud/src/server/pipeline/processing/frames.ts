import 'server-only'
import { copyFile, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { getEnv } from '@/env'
import { runFfmpeg } from './ffmpeg'
import { assetWorkDir } from './paths'
import { probeImageSize } from './probe-image'

/**
 * 关键帧抽样（arch/05 §3.6）：
 * - 采样：场景检测 + 1 帧/15s，一次解码三条支线（基线帧 / 画质统计 / 场景切点）。
 * - 质量门：非纯色、非黑屏（亮度 + 对比度阈值），不合格直接丢弃。
 * - 去重：时间过近的帧只留一张；总数受 PIPELINE_MAX_FRAMES 约束。
 */

/** 质量门阈值：亮度落在 [24, 240] 且对比度（YHIGH-YLOW）≥ 12 才算可用帧。 */
const MIN_LUMA = 24
const MAX_LUMA = 240
const MIN_CONTRAST = 12

/** 场景切点阈值（scdet score）。 */
const SCENE_THRESHOLD = 8

/** 两帧时间距离小于此值视为重复帧（毫秒）。 */
const DEDUP_GAP_MS = 3_000

export type ExtractedFrame = {
  /** 帧在片中的时间（毫秒）。 */
  atMs: number
  /** 落盘绝对路径。 */
  path: string
  width: number | null
  height: number | null
}

type FrameStats = { index: number; atMs: number; luma: number; contrast: number }

type Candidate = { stat: FrameStats; file: string }

export async function extractFrames(input: {
  assetId: string
  sourcePath: string
  /** 关键帧落盘目录（媒体存储的持久位）。 */
  framesDir: string
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
}): Promise<ExtractedFrame[]> {
  const env = getEnv()
  const workDir = assetWorkDir(input.assetId)
  const sampleDir = join(workDir, 'sample')
  await mkdir(sampleDir, { recursive: true })
  await mkdir(input.framesDir, { recursive: true })

  const statsPath = join(workDir, 'frame-stats.txt')
  const scenesPath = join(workDir, 'scene-times.txt')
  const interval = env.PIPELINE_FRAME_INTERVAL_SECONDS

  // 一次解码，三条支线：基线帧 / 画质统计 / 场景切点。
  // metadata 滤镜的输出必须显式接到输出流（ffmpeg 8.x 拒绝悬空输出垫，报 exit 234），
  // 两条统计支线各接一路 null muxer。
  await runFfmpeg({
    args: [
      '-y',
      '-i',
      input.sourcePath,
      '-filter_complex',
      `[0:v]split=2[base][sdb];` +
        `[base]fps=1/${interval},scale='min(1600,iw)':-2,format=yuvj420p,split=2[out][st];` +
        `[st]signalstats,metadata=print:file=${statsPath}[statOut];` +
        `[sdb]scdet=threshold=${SCENE_THRESHOLD},metadata=print:file=${scenesPath}[sceneOut]`,
      '-map',
      '[out]',
      '-q:v',
      '2',
      '-frames:v',
      String(env.PIPELINE_MAX_FRAMES * 2),
      join(sampleDir, 'base-%05d.jpg'),
      '-map',
      '[statOut]',
      '-f',
      'null',
      '-',
      '-map',
      '[sceneOut]',
      '-f',
      'null',
      '-',
    ],
    shouldCancel: input.shouldCancel,
  })

  const stats = parseFrameStats(await readText(statsPath))
  const baseFiles = await listJpg(sampleDir)

  const candidates: Candidate[] = []
  for (const file of baseFiles) {
    // 基线帧文件序号从 1 开始，统计条目从 0 开始。
    const stat = stats.find((s) => s.index === file.index - 1)
    if (!stat) continue
    if (!passesQualityGate(stat)) {
      await rm(file.path, { force: true })
      continue
    }
    candidates.push({ stat, file: file.path })
  }

  // 场景切点补充抽样：与已有帧太近的丢弃。
  for (const atMs of parseSceneTimes(await readText(scenesPath))) {
    if (candidates.length >= env.PIPELINE_MAX_FRAMES) break
    if (candidates.some((c) => Math.abs(c.stat.atMs - atMs) < DEDUP_GAP_MS)) continue
    const out = join(sampleDir, `scene-${atMs}.jpg`)
    const stat = await extractSingleFrame({
      sourcePath: input.sourcePath,
      atMs,
      output: out,
      shouldCancel: input.shouldCancel,
    })
    if (!stat || !passesQualityGate(stat)) {
      await rm(out, { force: true })
      continue
    }
    candidates.push({ stat: { ...stat, index: -1 }, file: out })
  }

  candidates.sort((a, b) => a.stat.atMs - b.stat.atMs)
  const kept = candidates.slice(0, env.PIPELINE_MAX_FRAMES)

  const frames: ExtractedFrame[] = []
  for (const candidate of kept) {
    const target = join(input.framesDir, `${candidate.stat.atMs}.jpg`)
    await moveFile(candidate.file, target)
    frames.push({ atMs: candidate.stat.atMs, path: target, width: null, height: null })
  }

  await rm(sampleDir, { recursive: true, force: true })

  const size = frames.length > 0 ? await probeImageSize(frames[0]!.path) : null
  return frames.map((f) => ({
    ...f,
    width: size?.width ?? null,
    height: size?.height ?? null,
  }))
}

/**
 * 工作区 → 持久帧目录的移动：生产容器里两者分属不同挂载卷
 * （/data/pipeline 与 /media/sources），rename 跨卷抛 EXDEV，回退复制+删源。
 */
export async function moveFile(from: string, to: string): Promise<void> {
  await rm(to, { force: true })
  try {
    await rename(from, to)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyFile(from, to)
    await rm(from, { force: true })
  }
}

export function passesQualityGate(stat: { luma: number; contrast: number }): boolean {
  if (stat.luma < MIN_LUMA || stat.luma > MAX_LUMA) return false
  return stat.contrast >= MIN_CONTRAST
}

/**
 * 单帧补抽（figures keyframe 兜底，arch/05 §8）：帧轨道没有落点附近帧时，
 * 从源片按时间点抽一帧到指定输出路径。返回 null 表示抽取失败（ffmpeg 异常/黑帧）。
 */
export async function extractFrameAt(input: {
  sourcePath: string
  atMs: number
  output: string
}): Promise<{ path: string } | null> {
  await mkdir(dirname(input.output), { recursive: true })
  const stats = await extractSingleFrame({
    sourcePath: input.sourcePath,
    atMs: input.atMs,
    output: input.output,
  })
  if (!stats) {
    await rm(input.output, { force: true })
    return null
  }
  return { path: input.output }
}

/** 单帧抽取：按时间点取一帧，顺带算亮度与对比度。 */
async function extractSingleFrame(input: {
  sourcePath: string
  atMs: number
  output: string
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
}): Promise<FrameStats | null> {
  const statsPath = `${input.output}.stats.txt`
  try {
    await runFfmpeg({
      args: [
        '-y',
        '-ss',
        (input.atMs / 1000).toFixed(3),
        '-i',
        input.sourcePath,
        '-frames:v',
        '1',
        '-vf',
        `scale='min(1600,iw)':-2,signalstats,metadata=print:file=${statsPath}`,
        '-q:v',
        '2',
        input.output,
      ],
      shouldCancel: input.shouldCancel,
    })
  } catch {
    await rm(input.output, { force: true })
    return null
  }
  const stats = parseFrameStats(await readText(statsPath))
  await rm(statsPath, { force: true })
  const first = stats[0]
  if (!first) return null
  return { index: -1, atMs: input.atMs, luma: first.luma, contrast: first.contrast }
}

/** 解析 signalstats 的 metadata 输出：每帧一组 YAVG/YHIGH/YLOW。 */
export function parseFrameStats(raw: string): FrameStats[] {
  const out: FrameStats[] = []
  let index = -1
  let atMs = 0
  let luma = 0
  let yhigh = 0
  let ylow = 0
  let seen = false

  const flush = () => {
    if (index >= 0 && seen) out.push({ index, atMs, luma, contrast: yhigh - ylow })
    index = -1
    luma = 0
    yhigh = 0
    ylow = 0
    seen = false
  }

  for (const line of raw.split('\n')) {
    const header = /^frame:\s*(\d+)\s+pts:\s*\S+\s+pts_time:\s*(-?[\d.]+)/.exec(line)
    if (header) {
      flush()
      index = Number(header[1])
      atMs = Math.round(Number(header[2]) * 1000)
      continue
    }
    const match = /lavfi\.signalstats\.(YAVG|YHIGH|YLOW)=(-?[\d.]+)/.exec(line)
    if (!match) continue
    const value = Number(match[2])
    if (match[1] === 'YAVG') {
      luma = value
      seen = true
    } else if (match[1] === 'YHIGH') yhigh = value
    else ylow = value
  }
  flush()
  return out
}

/**
 * 解析场景切点（秒 → 毫秒）。
 *
 * ffmpeg 8.x 的 scdet 只吐 `lavfi.scd.mafd` 与 `lavfi.scd.score`，
 * **不吐 `lavfi.scd.time`**——切点要靠「该帧 score ≥ 阈值」判定，时间取帧头的 pts_time。
 * （早先按 `lavfi.scd.time` 解析，场景检测实际一直是空转。）
 */
export function parseSceneTimes(raw: string, threshold = SCENE_THRESHOLD): number[] {
  const times: number[] = []
  let pts: number | null = null

  for (const line of raw.split('\n')) {
    const header = /^frame:\s*(\d+)\s+pts:\s*\S+\s+pts_time:\s*(-?[\d.]+)/.exec(line)
    if (header) {
      pts = Number(header[2])
      continue
    }
    // 少数版本仍会给出 scd.time，优先采用。
    const direct = /lavfi\.scd\.time=(-?[\d.]+)/.exec(line)
    if (direct) {
      const at = Number(direct[1])
      if (Number.isFinite(at) && at >= 0) times.push(Math.round(at * 1000))
      continue
    }
    const score = /lavfi\.scd\.score=(-?[\d.]+)/.exec(line)
    if (score && pts !== null) {
      const value = Number(score[1])
      if (Number.isFinite(value) && value >= threshold && pts >= 0) {
        times.push(Math.round(pts * 1000))
      }
    }
  }
  return [...new Set(times)].sort((a, b) => a - b)
}

async function listJpg(dir: string): Promise<{ index: number; path: string }[]> {
  const names = await readdir(dir)
  return names
    .filter((n) => n.startsWith('base-') && n.endsWith('.jpg'))
    .map((n) => ({
      index: Number(n.slice('base-'.length, -'.jpg'.length)),
      path: join(dir, n),
    }))
    .sort((a, b) => a.index - b.index)
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
