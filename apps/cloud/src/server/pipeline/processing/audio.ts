import 'server-only'
import { mkdir } from 'node:fs/promises'
import { getEnv } from '@/env'
import { runFfmpeg } from './ffmpeg'
import { assetWorkDir } from './paths'
import { planChunks, type AudioChunk } from '../asr/chunk'

/**
 * 音频抽取与切块（arch/05 §3.4–§3.5）：
 * 抽 16kHz 单声道 PCM16 → 静音检测取切点 → 按 ≤480s 切块（切点吸附静音）。
 */

export type AudioExtraction = {
  /** 16kHz 单声道 PCM16 的 WAV 路径。 */
  audioPath: string
  /** 原始素材时长（秒）。 */
  durationS: number
  /** 静音切点（秒），升序。 */
  silenceCuts: number[]
}

/** 抽音频并检测静音。返回音频路径与切点。 */
export async function extractAudio(input: {
  assetId: string
  sourcePath: string
  durationS: number
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
}): Promise<AudioExtraction> {
  const dir = assetWorkDir(input.assetId)
  await mkdir(dir, { recursive: true })
  const audioPath = `${dir}/audio.wav`

  await runFfmpeg({
    args: [
      '-y',
      '-i',
      input.sourcePath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      audioPath,
    ],
    shouldCancel: input.shouldCancel,
  })

  const silenceCuts = await detectSilence(audioPath, input.shouldCancel)
  return { audioPath, durationS: input.durationS, silenceCuts }
}

/**
 * 静音检测（arch/05 §3.4）：-30dB / 0.5s，结果只从 stderr 读。
 * 解析失败按「没有静音点」处理——切块退回固定上限切，不让整条链路挂掉。
 */
export async function detectSilence(
  audioPath: string,
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined,
): Promise<number[]> {
  let stderr: string
  try {
    const result = await runFfmpeg({
      args: ['-y', '-i', audioPath, '-af', 'silencedetect=noise=-30dB:d=0.5', '-f', 'null', '-'],
      shouldCancel,
    })
    stderr = result.stderr
  } catch {
    return []
  }

  const cuts: number[] = []
  // silencedetect 输出：silence_start: 12.345 / silence_end: 13.456
  const pattern = /silence_end:\s*(-?[\d.]+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(stderr)) !== null) {
    const at = Number(match[1])
    if (Number.isFinite(at) && at > 0) cuts.push(at)
  }
  return cuts.sort((a, b) => a - b)
}

/** 按切点规划分块。 */
export function planAudioChunks(input: {
  durationS: number
  silenceCuts: number[]
}): AudioChunk[] {
  return planChunks({
    durationS: input.durationS,
    chunkSeconds: getEnv().PIPELINE_CHUNK_SECONDS,
    silenceCuts: input.silenceCuts,
  })
}

/** 从整段音频切出一块（16kHz 单声道 PCM16）。 */
export async function cutChunk(input: {
  assetId: string
  audioPath: string
  chunk: AudioChunk
  shouldCancel?: (() => boolean | Promise<boolean>) | undefined
}): Promise<string> {
  const dir = assetWorkDir(input.assetId)
  await mkdir(dir, { recursive: true })
  const output = `${dir}/chunk-${input.chunk.index}.wav`
  const duration = Math.max(0.1, input.chunk.endS - input.chunk.startS)
  await runFfmpeg({
    args: [
      '-y',
      '-ss',
      input.chunk.startS.toFixed(3),
      '-t',
      duration.toFixed(3),
      '-i',
      input.audioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      output,
    ],
    shouldCancel: input.shouldCancel,
  })
  return output
}
