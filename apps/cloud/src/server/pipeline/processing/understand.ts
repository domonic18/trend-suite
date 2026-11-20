import 'server-only'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { LlmError, runLlmJson } from '@/server/content/agents/llm'
import * as repo from './repo'
import type { ProcessingContext } from './runner'

/**
 * 素材理解阶段（arch/05 §4「理解 Agent」）：VLM 逐块读「转写分组 + 采样帧」，
 * 产出 source units——事实回溯的最小证据单元（时间范围/转写/画面描述/图表类型/讲解要点/关键帧引用）。
 *
 * 幂等：按 transcript_segments.chunk_index 分组，已完成块跳过（source_units.chunk_index），
 * 重跑只补缺失块。失败与素材 ready 解耦：理解挂了不抛错，素材照常就绪，
 * 单元缺口靠重跑补齐；生产引擎查不到 units 时该节明确失败（no_source_units）。
 */

/** 理解块数上限：已转块超过此数按序补，防超长素材一次烧穿额度。 */
const MAX_CHUNKS_PER_RUN = 12
/** 每块采样帧上限（额度护栏）。 */
const FRAMES_PER_CHUNK = 6
/**
 * 输出预算：推理型模型（M3.1-Flash 等）的思考与正文共用 max_tokens——
 * 4K 上限会被思考吃光，JSON 直接截断（与 PR #33 的目录代拟同一个坑）。
 * 与目录代拟对齐取 12K。
 */
const UNDERSTAND_MAX_TOKENS = 12_000

const understandOutput = z.object({
  units: z
    .array(
      z.object({
        startMs: z.number().int().min(0),
        endMs: z.number().int().min(0),
        text: z.string().min(1),
        visualDesc: z.string().nullable().default(null),
        chartType: z.string().nullable().default(null),
        teachingPoints: z.array(z.string()).default([]),
      }),
    )
    .min(1),
})

const UNDERSTAND_SYSTEM = `你是课程录像的素材理解助手。输入是一段课程的转写文本（带时间戳）与该时段的采样帧图片。
请把这段素材切分成 1~6 个「证据单元」：每个单元是一段连贯的教学讲解（一个知识点/一次演示/一张图表的讲解）。
对每个单元输出：
- startMs/endMs：时间范围（毫秒整数，必须落在本段时间窗内，endMs > startMs）
- text：该单元的转写原话（可轻度整理语气词，不得改写事实）
- visualDesc：画面里讲师在演示/指着什么（一句话；没有画面信息就 null）
- chartType：画面中图表的类型（如 k线/折线/表格/无，没有就 null）
- teachingPoints：2~4 条讲解要点（短句）
只输出 JSON：{"units":[...]}。不要输出任何解释文字。`

type UnderstandUnit = z.infer<typeof understandOutput>['units'][number]

/** 理解阶段入口：永不抛错——失败进 progress 消息，素材照常 ready。 */
export async function understandStage(ctx: ProcessingContext): Promise<void> {
  try {
    const segments = await repo.listSegments(ctx.assetId)
    if (segments.length === 0) {
      await ctx.onProgress?.({ step: 'understand', progress: 92, message: '无转写内容，跳过理解' })
      return
    }

    const completed = await repo.completedUnderstandChunkIndexes(ctx.assetId)
    const groups = groupByChunk(segments).filter((g) => !completed.has(g.chunkIndex))
    if (groups.length === 0) {
      await ctx.onProgress?.({ step: 'understand', progress: 92, message: '理解已完成' })
      return
    }

    const frames = await repo.listFrames(ctx.assetId)
    const pending = groups.slice(0, MAX_CHUNKS_PER_RUN)
    let failed = 0
    let modelNotConfigured = false

    for (let i = 0; i < pending.length; i += 1) {
      if (await ctx.shouldCancel?.()) return
      const group = pending[i]!
      const base = 86 + Math.round((i / pending.length) * 6)
      await ctx.onProgress?.({
        step: 'understand',
        progress: base,
        message: `素材理解（${i + 1}/${pending.length} 块）`,
      })
      const outcome = await understandChunkWithRetry(ctx, group, frames)
      if (outcome === 'model_not_configured') {
        modelNotConfigured = true
        break
      }
      if (outcome === 'failed') failed += 1
    }

    const skipped = groups.length - pending.length
    const parts: string[] = []
    if (modelNotConfigured) parts.push('未配置 VLM 渠道')
    if (failed > 0) parts.push(`${failed} 块失败`)
    if (skipped > 0) parts.push(`${skipped} 块超单轮上限`)
    await ctx.onProgress?.({
      step: 'understand',
      progress: 92,
      message: parts.length > 0 ? `理解未完成（${parts.join('，')}），重跑可补齐` : '理解完成',
    })
  } catch (err) {
    // 理解是生产侧增强，不阻断素材就绪（arch/05 §4 迭代 6 落地口径）。
    await ctx.onProgress?.({
      step: 'understand',
      progress: 92,
      message: `理解失败：${(err as Error).message.slice(0, 80)}，重跑可补齐`,
    })
  }
}

/**
 * 单块理解：可重试的失败（最常见是推理模型的思考吃光 max_tokens 导致的截断）
 * 再试一次——推理长度每次不同，重试常常就过了。没配 VLM 是配置问题，整批放弃。
 */
async function understandChunkWithRetry(
  ctx: ProcessingContext,
  group: SegmentGroup,
  frames: repo.MediaFrameRow[],
): Promise<'ok' | 'failed' | 'model_not_configured'> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await understandChunk(ctx, group, frames)
      return 'ok'
    } catch (err) {
      if (err instanceof LlmError && err.code === 'model_not_configured') {
        return 'model_not_configured'
      }
      if (attempt === 0 && err instanceof LlmError && err.retryable) continue
      return 'failed'
    }
  }
  return 'failed'
}

type SegmentGroup = {
  chunkIndex: number
  startMs: number
  endMs: number
  segments: repo.TranscriptSegmentRow[]
}

function groupByChunk(segments: repo.TranscriptSegmentRow[]): SegmentGroup[] {
  const map = new Map<number, repo.TranscriptSegmentRow[]>()
  for (const segment of segments) {
    const list = map.get(segment.chunk_index) ?? []
    list.push(segment)
    map.set(segment.chunk_index, list)
  }
  return [...map.entries()]
    .map(([chunkIndex, list]) => ({
      chunkIndex,
      startMs: Math.min(...list.map((s) => s.start_ms)),
      endMs: Math.max(...list.map((s) => s.end_ms)),
      segments: [...list].sort((a, b) => a.start_ms - b.start_ms),
    }))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
}

async function understandChunk(
  ctx: ProcessingContext,
  group: SegmentGroup,
  frames: repo.MediaFrameRow[],
): Promise<void> {
  const sampled = sampleFrames(frames, group.startMs, group.endMs, FRAMES_PER_CHUNK)
  const images = []
  for (const frame of sampled) {
    const bytes = await readFile(frame.path)
    images.push({ mediaType: 'image/jpeg' as const, base64: bytes.toString('base64') })
  }

  const transcript = group.segments
    .map((s) => `[${(s.start_ms / 1000).toFixed(1)}s-${(s.end_ms / 1000).toFixed(1)}s] ${s.text}`)
    .join('\n')
  const user = [
    `本段时间窗：${(group.startMs / 1000).toFixed(1)}s ~ ${(group.endMs / 1000).toFixed(1)}s。`,
    sampled.length > 0
      ? `附 ${sampled.length} 张该时段采样帧（按时间顺序）。`
      : '本段没有可用画面帧，仅凭转写切分。',
    '',
    '转写文本：',
    transcript,
  ].join('\n')

  const { data, runId } = await runLlmJson({
    task: 'vision.describe',
    purpose: 'vlm',
    refType: 'media_asset',
    refId: ctx.assetId,
    phase: 'understand',
    system: UNDERSTAND_SYSTEM,
    user,
    maxTokens: UNDERSTAND_MAX_TOKENS,
    images,
    schema: understandOutput,
    summarize: (d) => `${d.units.length} 个证据单元`,
  })

  const units = data.units
    .map((unit) => clampUnit(unit, group))
    .filter((unit): unit is NonNullable<ReturnType<typeof clampUnit>> => unit !== null)
  if (units.length === 0) {
    throw new Error('理解产物没有落在时间窗内的单元')
  }
  await repo.insertSourceUnits({
    courseId: ctx.courseId,
    assetId: ctx.assetId,
    chunkIndex: group.chunkIndex,
    modelId: runId,
    units: units.map((unit) => ({
      startMs: unit.startMs,
      endMs: unit.endMs,
      text: unit.text,
      visualDesc: unit.visualDesc,
      conceptRefs: [],
      chartType: unit.chartType,
      teachingPoints: unit.teachingPoints,
      frameIds: sampled.map((f) => f.id),
    })),
  })
}

/** 窗口钳制：越界单元收进块边界，倒置/空转的丢弃。 */
function clampUnit(unit: UnderstandUnit, group: SegmentGroup): { startMs: number; endMs: number; text: string; visualDesc: string | null; chartType: string | null; teachingPoints: string[] } | null {
  const startMs = Math.max(group.startMs, unit.startMs)
  const endMs = Math.min(group.endMs, unit.endMs)
  if (endMs - startMs < 1000) return null
  return {
    startMs,
    endMs,
    text: unit.text.slice(0, 4000),
    visualDesc: unit.visualDesc?.slice(0, 500) ?? null,
    chartType: unit.chartType?.slice(0, 40) ?? null,
    teachingPoints: unit.teachingPoints.slice(0, 6).map((point) => point.slice(0, 200)),
  }
}

/** 窗口内均匀采样 ≤limit 帧；帧不在窗口内则取全程均匀（画面节奏与转写不必对齐）。 */
export function sampleFrames(
  frames: repo.MediaFrameRow[],
  startMs: number,
  endMs: number,
  limit: number,
): repo.MediaFrameRow[] {
  const inWindow = frames.filter((f) => f.at_ms >= startMs - 15_000 && f.at_ms <= endMs + 15_000)
  const pool = inWindow.length > 0 ? inWindow : frames
  if (pool.length <= limit) return pool
  const step = (pool.length - 1) / (limit - 1)
  const picked: repo.MediaFrameRow[] = []
  for (let i = 0; i < limit; i += 1) {
    picked.push(pool[Math.round(i * step)]!)
  }
  return picked
}
