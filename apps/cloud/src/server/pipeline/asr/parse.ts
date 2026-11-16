/**
 * ASR 返回解析（arch/05 §3.5）：解析器要兼容不同厂商的段落形状与时间键，
 * 只认「文本 + 起止时间」，其余字段（说话人、置信度）有就用、没有就空着。
 */

export type AsrSegment = {
  /** 段落在音频内的起止（毫秒）。 */
  startMs: number
  endMs: number
  text: string
  speaker: string | null
}

export type AsrResult = {
  text: string
  durationS: number | null
  segments: AsrSegment[]
  /** 上游说话人数量（diarization）。 */
  speakerCount: number | null
}

type RawSegment = Record<string, unknown>

const SEGMENT_KEYS = ['segments', 'sentences', 'utterances', 'results'] as const

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of ['text', 'content', 'sentence', 'transcript']) {
      if (typeof obj[key] === 'string') return obj[key] as string
    }
  }
  return ''
}

/** 时间可能是秒（number）或毫秒（带 _ms 后缀）；带 _ms 的优先。 */
function timeMs(direct: unknown, ms: unknown): number | null {
  const msValue = num(ms)
  if (msValue !== null) return msValue
  const value = num(direct)
  if (value === null) return null
  return Math.round(value * 1000)
}

function pickSegments(payload: Record<string, unknown>): RawSegment[] {
  for (const key of SEGMENT_KEYS) {
    const value = payload[key]
    if (Array.isArray(value)) return value.filter((v): v is RawSegment => typeof v === 'object' && v !== null)
  }
  return []
}

export function parseAsrResponse(raw: unknown): AsrResult {
  if (!raw || typeof raw !== 'object') {
    return { text: '', durationS: null, segments: [], speakerCount: null }
  }
  const payload = raw as Record<string, unknown>
  const segments: AsrSegment[] = []

  for (const item of pickSegments(payload)) {
    const text = textOf(item.text ?? item).trim()
    if (!text) continue
    const startMs = timeMs(
      item.start ?? item.start_time ?? item.begin ?? item.start_ms,
      item.start_ms,
    )
    const endMs = timeMs(item.end ?? item.end_time ?? item.finish ?? item.end_ms, item.end_ms)
    if (startMs === null || endMs === null) continue
    const speaker = typeof item.speaker === 'string' ? item.speaker : null
    segments.push({ startMs, endMs, text, speaker })
  }

  const durationS = num(payload.duration ?? payload.duration_s ?? payload.audio_duration)
  const speakerCount = num(payload.n_speakers ?? payload.speaker_count)

  const text =
    typeof payload.text === 'string' && payload.text.trim()
      ? payload.text.trim()
      : segments.map((s) => s.text).join('')

  return {
    text,
    durationS: durationS !== null && durationS > 0 ? durationS : null,
    segments,
    speakerCount: speakerCount !== null ? Math.trunc(speakerCount) : null,
  }
}

/**
 * 时间戳归一：块内局部毫秒 + 块起点 → 全局毫秒。
 * 单调不重叠：后一段的起点不得早于前一段的终点，冲突时以终点为准裁剪。
 */
export function toGlobalSegments(
  segments: AsrSegment[],
  offsetMs: number,
): AsrSegment[] {
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
  const out: AsrSegment[] = []
  let floor = -1
  for (const seg of sorted) {
    const startMs = Math.max(0, seg.startMs + offsetMs)
    const endMs = Math.max(startMs, seg.endMs + offsetMs)
    const boundedStart = Math.max(startMs, floor)
    if (endMs <= boundedStart) continue
    out.push({ ...seg, startMs: boundedStart, endMs })
    floor = endMs
  }
  return out
}

/** 段落切分口径：≤30 秒一段（arch/05 §3.5）。过长的上游段落按时间切开。 */
export const MAX_SEGMENT_MS = 30_000

export function splitLongSegments(segments: AsrSegment[]): AsrSegment[] {
  const out: AsrSegment[] = []
  for (const seg of segments) {
    const span = seg.endMs - seg.startMs
    if (span <= MAX_SEGMENT_MS) {
      out.push(seg)
      continue
    }
    const parts = Math.ceil(span / MAX_SEGMENT_MS)
    const step = Math.floor(span / parts)
    for (let i = 0; i < parts; i += 1) {
      const startMs = seg.startMs + i * step
      const endMs = i === parts - 1 ? seg.endMs : startMs + step
      out.push({ ...seg, startMs, endMs })
    }
  }
  return out
}
