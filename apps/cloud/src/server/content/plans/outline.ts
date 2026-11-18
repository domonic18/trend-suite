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
 */
export function buildSkeleton(
  outline: CourseOutlineView,
  matches: OutlineMatch[],
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
      }
    }),
  }
  return { skeleton, violations }
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
