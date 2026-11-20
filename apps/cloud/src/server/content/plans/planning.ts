import 'server-only'
import type { SourceUnitRow } from '@/server/pipeline/processing/repo'

/**
 * 智能规划的输入与规模推导（迭代 8）。
 *
 * 规划不再把转写原文整段塞进提示词，而是用素材理解产出的「教学要点」清单——
 * 每条要点带出处（素材 + 时间码 + 证据单元 id），目录规模由要点数推导，
 * 与素材无关的绝对上限降级为成本兜底。
 *
 * 「一课时 = 一个可独立讲清的知识点」：一个课时最多覆盖
 * MAX_POINTS_PER_LESSON 条要点，且至少要有 MIN_MINUTES_PER_LESSON 分钟素材可讲。
 */

/** 一课时的时长下限（分钟）：低于这个时长讲不清一个知识点。 */
export const MIN_MINUTES_PER_LESSON = 8
/** 一课时最多覆盖的教学要点数：超出就不是「一个知识点」了。 */
export const MAX_POINTS_PER_LESSON = 3
/** 每课时最少覆盖的教学要点数：低于它说明要点被摊得太薄。 */
export const MIN_POINTS_PER_LESSON = 1
/** 课时数绝对上限：九步生产的成本护栏（规模推导之后的兜底，不是目标）。 */
export const MAX_LESSONS = 40
/** 目标口径：平均每课时覆盖的要点数。 */
export const TARGET_POINTS_PER_LESSON = 1.8

/** 规划输入里的一个证据单元：一条要点集合，带出处。 */
export type PlanningUnit = {
  id: string
  assetId: string
  assetName: string
  startMs: number
  endMs: number
  points: string[]
}

/** 课时规模区间：给 Agent 的硬边界（超界即判规划不合格）。 */
export type LessonBudget = { min: number; max: number; target: number }

/** 教学要点：来自 source_units.extra.teachingPoints（迭代 6 理解阶段）。 */
export function teachingPointsOf(extra: unknown): string[] {
  if (!extra || typeof extra !== 'object') return []
  const raw = (extra as { teachingPoints?: unknown }).teachingPoints
  if (!Array.isArray(raw)) return []
  return raw
    .filter((point): point is string => typeof point === 'string' && point.trim().length > 0)
    .map((point) => point.trim())
}

/** 证据单元 → 规划输入单元（按素材名标注出处；没有要点的不进规划输入）。 */
export function buildPlanningUnits(
  rows: SourceUnitRow[],
  assetNames: Map<string, string>,
): PlanningUnit[] {
  const units: PlanningUnit[] = []
  for (const row of rows) {
    const points = teachingPointsOf(row.extra)
    if (points.length === 0) continue
    units.push({
      id: row.id,
      assetId: row.asset_id,
      assetName: assetNames.get(row.asset_id) ?? '素材',
      startMs: row.start_ms,
      endMs: row.end_ms,
      points,
    })
  }
  return units
}

/** 规划输入里的要点总数——目录规模的天然上界。 */
export function totalPoints(units: PlanningUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.points.length, 0)
}

/**
 * 由素材推导课时规模区间。
 *
 * 三条约束：
 * - 粒度：一课时至少一个知识点 → 课时数不超过要点数；
 * - 时长：一课时至少 MIN_MINUTES_PER_LESSON 分钟素材（时长未知时不参与约束）；
 * - 成本兜底：MAX_LESSONS。
 *
 * min 取上限的一半（别摊得太薄），target 按每课时约 TARGET_POINTS_PER_LESSON 条要点推。
 */
export function deriveLessonBudget(input: { pointCount: number; totalMinutes: number }): LessonBudget {
  const points = Math.max(0, Math.floor(input.pointCount))
  const minutes = Math.max(0, Math.floor(input.totalMinutes))
  const timeCap =
    minutes > 0 ? Math.max(1, Math.floor(minutes / MIN_MINUTES_PER_LESSON)) : MAX_LESSONS
  const max = Math.max(1, Math.min(points, timeCap, MAX_LESSONS))
  const min = Math.max(1, Math.floor(max / 2))
  const target = Math.max(min, Math.min(max, Math.round(points / TARGET_POINTS_PER_LESSON)))
  return { min, max, target }
}

/**
 * 素材总时长（分钟）：优先取证据单元覆盖的时间跨度，素材标称时长更大就用标称值。
 * 两个口径都缺（素材还没产出单元）时按 0 算——此时规模只由要点数决定。
 *
 * assetDurations 的单位是秒（对齐 media_assets.duration_s）。
 */
export function deriveTotalMinutes(
  units: PlanningUnit[],
  assetDurations: Map<string, number | null>,
): number {
  const bounds = new Map<string, { min: number; max: number }>()
  for (const unit of units) {
    const bound = bounds.get(unit.assetId) ?? { min: unit.startMs, max: unit.endMs }
    bound.min = Math.min(bound.min, unit.startMs)
    bound.max = Math.max(bound.max, unit.endMs)
    bounds.set(unit.assetId, bound)
  }
  let ms = 0
  for (const [assetId, bound] of bounds) {
    const span = Math.max(0, bound.max - bound.min)
    const declared = Number(assetDurations.get(assetId) ?? 0) * 1000
    ms += Math.max(span, declared)
  }
  return Math.round(ms / 60_000)
}

/** 课时估时：由绑定的证据单元时长求和（比模型拍脑袋的分钟数可靠）。 */
export function estimateMinutesOf(units: PlanningUnit[], unitIds: string[]): number {
  const wanted = new Set(unitIds)
  const ms = units
    .filter((unit) => wanted.has(unit.id))
    .reduce((sum, unit) => sum + Math.max(0, unit.endMs - unit.startMs), 0)
  return Math.max(5, Math.min(240, Math.round(ms / 60_000)))
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 规划输入的提示词形态：按素材分组，每条要点带证据单元 id 与时间码。
 * Agent 只能引用这里出现的 id——引不到的出处一律无效。
 */
export function formatPlanningUnits(units: PlanningUnit[]): string {
  const byAsset = new Map<string, PlanningUnit[]>()
  for (const unit of units) {
    const list = byAsset.get(unit.assetId) ?? []
    list.push(unit)
    byAsset.set(unit.assetId, list)
  }
  const blocks: string[] = []
  for (const [assetId, list] of byAsset) {
    const name = list[0]?.assetName ?? '素材'
    const lines = list.map(
      (unit) =>
        `- ${unit.id} [${clock(unit.startMs)}–${clock(unit.endMs)}] ${unit.points.join('；')}`,
    )
    blocks.push(`【${name} ${assetId}】\n${lines.join('\n')}`)
  }
  return blocks.join('\n\n')
}
