import 'server-only'
import {
  type PlanConceptEdgeView,
  type PlanConceptMapView,
  type PlanConceptView,
  type PlanViolationView,
  conceptEdgeKinds,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'

/**
 * 概念归一（arch/05 §5 阶段三 + arch/03 §2.2）：
 * 重名概念只保留首个定义、其余明确拒绝（验收尺子 409 的草案层来源）；
 * 依赖边按概念名引用（LLM 不生成 id），未知名/自环/循环依赖被剔除并留痕。
 */

export type RawConceptInput = { name: string; aliases: string[]; definition: string | null }
export type RawConceptEdgeInput = { from: string; to: string; kind: string }

const MAX_CONCEPTS = 300

export function validateConceptMap(input: {
  concepts: RawConceptInput[]
  edges: RawConceptEdgeInput[]
}): { conceptMap: PlanConceptMapView; violations: PlanViolationView[] } {
  const violations: PlanViolationView[] = []

  // 概念重名：首个保留，其余拒绝（同课程名称唯一的数据库约束是批准时的兜底）。
  const byName = new Map<string, PlanConceptView>()
  const concepts: PlanConceptView[] = []
  for (const raw of input.concepts) {
    const name = raw.name.trim().slice(0, 120)
    if (name.length === 0) continue
    if (byName.has(name)) {
      violations.push({
        kind: 'concept_conflict',
        subject: name,
        reason: '概念重名，仅保留首个定义，其余已拒绝',
        resolved: true,
      })
      continue
    }
    if (concepts.length >= MAX_CONCEPTS) break
    const concept: PlanConceptView = {
      id: newId('concept'),
      name,
      aliases: dedupe(raw.aliases.map((alias) => alias.trim().slice(0, 120)).filter((alias) => alias.length > 0)).slice(0, 20),
      definition: raw.definition?.trim().slice(0, 2000) || null,
    }
    byName.set(name, concept)
    concepts.push(concept)
  }

  // 别名冲突：别名与任何其他概念名或别名撞车 → 剔除该别名并留痕。
  for (const concept of concepts) {
    concept.aliases = concept.aliases.filter((alias) => {
      const owner = aliasOwner(concepts, alias)
      if (owner && owner.id !== concept.id) {
        violations.push({
          kind: 'concept_conflict',
          subject: alias,
          reason: `别名「${alias}」与概念「${owner.name}」冲突，已移除`,
          resolved: true,
        })
        return false
      }
      return true
    })
  }

  // 依赖边：名字 → id；未知名、自环、重复边剔除；prerequisite 子图去环。
  const edges: PlanConceptEdgeView[] = []
  const seenEdges = new Set<string>()
  for (const raw of input.edges) {
    const kind = (conceptEdgeKinds as readonly string[]).includes(raw.kind)
      ? (raw.kind as PlanConceptEdgeView['kind'])
      : 'related'
    const from = byName.get(raw.from.trim())
    const to = byName.get(raw.to.trim())
    if (!from || !to) {
      violations.push({
        kind: 'concept_conflict',
        subject: `${raw.from} → ${raw.to}`,
        reason: '依赖边引用了未收录的概念，已移除',
        resolved: true,
      })
      continue
    }
    if (from.id === to.id) continue
    const key = `${from.id}|${to.id}|${kind}`
    if (seenEdges.has(key)) continue
    seenEdges.add(key)
    edges.push({ fromId: from.id, toId: to.id, kind })
  }

  const pruned = breakPrerequisiteCycles(edges, violations)

  return { conceptMap: { concepts, edges: pruned }, violations }
}

/** 别名的归属者：是某概念名，或某概念的已有别名。 */
function aliasOwner(concepts: PlanConceptView[], term: string): PlanConceptView | undefined {
  return (
    concepts.find((concept) => concept.name === term) ??
    concepts.find((concept) => concept.aliases.includes(term))
  )
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * prerequisite 子图无环（arch/03 §2.2）：Kahn 拓扑剩下的节点说明在环里，
 * 把环内节点的 prerequisite 边整体移除并留痕（related 边允许环，不动）。
 */
function breakPrerequisiteCycles(
  edges: PlanConceptEdgeView[],
  violations: PlanViolationView[],
): PlanConceptEdgeView[] {
  const prerequisites = edges.filter((edge) => edge.kind === 'prerequisite')
  const inDegree = new Map<string, number>()
  for (const edge of prerequisites) {
    inDegree.set(edge.toId, (inDegree.get(edge.toId) ?? 0) + 1)
    inDegree.set(edge.fromId, inDegree.get(edge.fromId) ?? 0)
  }
  const queue = [...inDegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
  const removed = new Set<string>()
  while (queue.length > 0) {
    const id = queue.shift()!
    removed.add(id)
    for (const edge of prerequisites) {
      if (edge.fromId !== id) continue
      const degree = (inDegree.get(edge.toId) ?? 0) - 1
      inDegree.set(edge.toId, degree)
      if (degree === 0) queue.push(edge.toId)
    }
  }

  const cyclic = prerequisites.filter(
    (edge) => !removed.has(edge.fromId) && !removed.has(edge.toId),
  )
  if (cyclic.length === 0) return edges
  violations.push({
    kind: 'concept_conflict',
    subject: cyclic.map((edge) => edge.fromId).join('、'),
    reason: '概念依赖存在循环，已移除相关依赖边',
    resolved: true,
  })
  return edges.filter((edge) => edge.kind !== 'prerequisite' || !cyclic.includes(edge))
}

/** 术语表视图与概念图谱同源（arch/05：concepts.name 即术语校验基准）。 */
export function glossaryOf(conceptMap: PlanConceptMapView): {
  items: { term: string; aliases: string[]; note: string | null }[]
} {
  return {
    items: conceptMap.concepts.map((concept) => ({
      term: concept.name,
      aliases: concept.aliases,
      note: concept.definition ? concept.definition.slice(0, 500) : null,
    })),
  }
}
