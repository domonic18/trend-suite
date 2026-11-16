/**
 * ASR 分块（arch/05 §3.5）：按静音切点切块，每块 ≤ 上游单条时长上限。
 * 上游超过上限会直接拒（不截断），所以块长必须留余量。
 */

export type AudioChunk = {
  index: number
  /** 相对素材起点的秒。 */
  startS: number
  endS: number
}

export const DEFAULT_CHUNK_SECONDS = 480

/**
 * 规划分块：
 * - 固定上限切块，再把切点**吸附**到附近的静音点上（切在静音处，句子不被切断）。
 * - 静音点来自 ffmpeg silencedetect（秒），没有就按固定上限切。
 */
export function planChunks(input: {
  durationS: number
  chunkSeconds?: number
  silenceCuts?: number[]
}): AudioChunk[] {
  const chunkSeconds = input.chunkSeconds ?? DEFAULT_CHUNK_SECONDS
  const duration = Math.max(0, input.durationS)
  if (duration <= 0) return []

  const cuts = (input.silenceCuts ?? [])
    .filter((s) => s > 0 && s < duration)
    .sort((a, b) => a - b)

  const chunks: AudioChunk[] = []
  let start = 0
  let index = 0

  while (start < duration) {
    const limit = Math.min(duration, start + chunkSeconds)
    if (limit >= duration) {
      chunks.push({ index, startS: start, endS: duration })
      break
    }
    // 在 [start+60%, limit] 区间里找最靠后的静音点：太早会切出很短块，太晚会超限。
    const windowStart = start + (limit - start) * 0.6
    let cut = limit
    for (const silence of cuts) {
      if (silence >= windowStart && silence <= limit) cut = silence
    }
    chunks.push({ index, startS: start, endS: cut })
    index += 1
    start = cut
  }

  return chunks
}

/** 切割点转 ffmpeg -ss/-t 参数。 */
export function chunkFfmpegArgs(chunk: AudioChunk, input: string, output: string): string[] {
  const duration = Math.max(0.1, chunk.endS - chunk.startS)
  return [
    '-y',
    '-ss',
    chunk.startS.toFixed(3),
    '-t',
    duration.toFixed(3),
    '-i',
    input,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    output,
  ]
}
