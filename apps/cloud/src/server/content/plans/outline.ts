import 'server-only'
import { z } from 'zod'
import {
  MAX_OUTLINE_NODES,
  parseOutlineText,
  type CourseOutlineView,
  type OutlineNode,
  type PlanSkeletonView,
  type PlanViolationView,
  sectionMatchStatuses,
} from '@trend-suite/contracts'
import { badRequest } from '@/server/lib/http'

/**
 * 目录先验（arch/05 §5 阶段三）：人工目录（篇→卷→课时三级）是骨架的唯一来源，
 * 方案不得发明目录之外的章节。解析失败给出行号让教师改格式。
 *
 * 解析规则本身在 @trend-suite/contracts（前后端共用）：教师端据此本地逐行提示、
 * 一键规整，服务端据此把关——口径只有一份。
 */

/** 证据匹配度阈值：低于它判 low_match，批准前需教师裁决（需求未定项起始值 0.5）。 */
export const MATCH_THRESHOLD = 0.5

export type { OutlineNode }

/** 「第X篇 / 第一章 / 一、/ 1.」三级行文 → 目录树；无法识别的行直接 400（带行号）。 */
export function parseOutline(text: string): CourseOutlineView {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    throw badRequest('目录不能为空', { path: 'outlineText', message: '请粘贴人工目录' })
  }
  if (lines.length > MAX_OUTLINE_NODES) {
    throw badRequest(`目录最多 ${MAX_OUTLINE_NODES} 行`, {
      path: 'outlineText',
      message: `目录最多 ${MAX_OUTLINE_NODES} 行`,
    })
  }

  const { nodes, issues } = parseOutlineText(text)
  const first = issues[0]
  if (first) {
    throw badRequest(`目录第 ${first.index} 行无法识别层级`, {
      path: 'outlineText',
      message: first.message,
    })
  }
  return { nodes }
}

/** LLM 返回的匹配条目：nodeId 必须在目录内（白名单），分数缺省视为无证据。 */
export type OutlineMatch = { nodeId: string; matchScore: number | null }

/**
 * 骨架 = 目录全量节点 + 每章匹配度。LLM 引用的未知节点进 violations（目录外发明）；
 * LLM 漏掉的目录节点保留且视为无证据（low_match）——目录是下界，不是交集。
 *
 * unitIdsByNodeId：智能规划时每个节点绑定的证据单元（出处），一并进骨架。
 */
export function buildSkeleton(
  outline: CourseOutlineView,
  matches: OutlineMatch[],
  unitIdsByNodeId?: Map<string, string[]>,
): { skeleton: PlanSkeletonView; violations: PlanViolationView[] } {
  const violations: PlanViolationView[] = []
  const scoreById = new Map<string, number | null>()
  const knownIds = new Set(outline.nodes.map((node) => node.id))
  for (const match of matches) {
    if (!knownIds.has(match.nodeId)) {
      violations.push({
        kind: 'outline_violation',
        subject: match.nodeId,
        reason: '不在人工目录中，已拒绝（目录先验：方案不得发明章节）',
      })
      continue
    }
    scoreById.set(match.nodeId, match.matchScore)
  }

  const skeleton: PlanSkeletonView = {
    nodes: outline.nodes.map((node) => {
      const score = scoreById.get(node.id) ?? null
      return {
        ...node,
        matchScore: score,
        matchStatus: score !== null && score >= MATCH_THRESHOLD ? 'ok' : 'low_match',
        sourceUnitIds: unitIdsByNodeId?.get(node.id) ?? [],
      }
    }),
  }
  return { skeleton, violations }
}

/**
 * 由证据绑定推导匹配度（智能规划用）：课时有出处即 1，无出处即无证据；
 * 章与篇取子节点的覆盖比例——孩子里有一半没出处，父章节就不该显示满匹配。
 * 全部子节点都没出处时父章节同样无证据（null）。
 */
export function deriveMatchesFromUnits(
  outline: CourseOutlineView,
  unitIdsByNodeId: Map<string, string[]>,
): OutlineMatch[] {
  const children = new Map<string, string[]>()
  for (const node of outline.nodes) {
    if (!node.parentId) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const scoreById = new Map<string, number | null>()
  const resolve = (nodeId: string): number | null => {
    if (scoreById.has(nodeId)) return scoreById.get(nodeId) ?? null
    const node = outline.nodes.find((item) => item.id === nodeId)
    if (!node) return null
    let score: number | null
    if (node.level === 3) {
      score = (unitIdsByNodeId.get(nodeId)?.length ?? 0) > 0 ? 1 : null
    } else {
      const childIds = children.get(nodeId) ?? []
      const childScores = childIds.map((childId) => resolve(childId))
      const covered = childScores.filter((value): value is number => value !== null)
      score =
        covered.length > 0
          ? covered.reduce((a, b) => a + b, 0) / childIds.length
          : null
    }
    scoreById.set(nodeId, score)
    return score
  }
  return outline.nodes.map((node) => ({ nodeId: node.id, matchScore: resolve(node.id) }))
}

/**
 * 规模裁剪（智能规划）：模型给的课时数超出素材推导的上限时裁掉多出来的，
 * 并把裁掉的数量带出去记拒绝记录——不能静默接受，也不能让模型自由铺开。
 *
 * 裁剪后清掉空章与空篇：没有课时的章、章都空的篇留着只是噪声。
 */
export function trimOutlineToBudget(
  outline: CourseOutlineView,
  maxLessons: number,
): { outline: CourseOutlineView; trimmed: number } {
  const lessons = outline.nodes.filter((node) => node.level === 3)
  if (lessons.length <= maxLessons) return { outline, trimmed: 0 }
  const kept = new Set(lessons.slice(0, maxLessons).map((node) => node.id))
  const hasChild = new Set(
    outline.nodes.filter((node) => node.parentId && kept.has(node.id)).map((node) => node.parentId!),
  )
  const keptChapter = new Set(
    outline.nodes.filter((node) => node.level === 2 && hasChild.has(node.id)).map((node) => node.id),
  )
  const hasChapter = new Set(
    outline.nodes.filter((node) => node.level === 2 && keptChapter.has(node.id)).map((node) => node.parentId!),
  )
  const nodes = outline.nodes.filter((node) => {
    if (node.level === 3) return kept.has(node.id)
    if (node.level === 2) return keptChapter.has(node.id)
    return hasChapter.has(node.id)
  })
  return { outline: { nodes }, trimmed: lessons.length - maxLessons }
}

/**
 * 微调新增章节要同时进目录树（白名单来源），保证「骨架 ⊆ 目录」不变量。
 * 新 id 取「n + 最大序号 + 1」，避免与解析产生的 id 冲突。
 */
export function appendOutlineNode(
  outline: CourseOutlineView,
  input: { parentId: string | null; title: string },
): { outline: CourseOutlineView; node: OutlineNode } {
  const maxSeq = outline.nodes.reduce((max, node) => {
    const match = /^n(\d+)$/.exec(node.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const parent = input.parentId
    ? outline.nodes.find((node) => node.id === input.parentId)
    : undefined
  if (input.parentId && !parent) {
    throw badRequest('父章节不存在')
  }
  const level = parent ? Math.min(parent.level + 1, 3) : 1
  const node: OutlineNode = {
    id: `n${maxSeq + 1}`,
    title: input.title,
    level: level as 1 | 2 | 3,
    parentId: input.parentId,
  }
  return { outline: { nodes: [...outline.nodes, node] }, node }
}

/** 叶子判断：remove/merge 只允许无子节点的章，避免孤儿层级。 */
export function isLeafNode(outline: CourseOutlineView, nodeId: string): boolean {
  return !outline.nodes.some((node) => node.parentId === nodeId)
}

const storedOutlineSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      level: z.number().int().min(1).max(3),
      parentId: z.string().nullable(),
    }),
  ),
})

/** courses.outline jsonb → 目录树；损坏返回 null（调用方自行定级：API 500 / worker 终态失败）。 */
export function parseStoredOutline(raw: unknown): CourseOutlineView | null {
  const parsed = storedOutlineSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function matchStatusOf(score: number | null): (typeof sectionMatchStatuses)[number] {
  return score !== null && score >= MATCH_THRESHOLD ? 'ok' : 'low_match'
}
