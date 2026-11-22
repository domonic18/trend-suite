import type { PlanSectionNodeView } from '@trend-suite/contracts'

/** 目录分组：一篇 → 若干章 → 若干课时。 */
export type OutlineChapterGroup = {
  chapter: PlanSectionNodeView
  lessons: PlanSectionNodeView[]
}

export type OutlinePartGroup = {
  /** 篇节点；骨架里出现没有篇的章时为 null。 */
  part: PlanSectionNodeView | null
  chapters: OutlineChapterGroup[]
  /** 找不到归属章的课时（骨架异常时的兜底）。 */
  loose: PlanSectionNodeView[]
}

/** 节点在同级里的位置（微调移动用：上移 / 下移）。 */
export type OutlineSiblingInfo = {
  parentId: string | null
  /** 同级序号（0 起）。 */
  index: number
  /** 同级总数。 */
  count: number
}

/** 某节点在同级中的位置；节点不存在返回 null。 */
export function siblingInfoOf(
  nodes: PlanSectionNodeView[],
  nodeId: string,
): OutlineSiblingInfo | null {
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) return null
  const siblings = nodes.filter((item) => item.parentId === node.parentId)
  return {
    parentId: node.parentId,
    index: siblings.findIndex((item) => item.id === nodeId),
    count: siblings.length,
  }
}

/**
 * 骨架节点 → 篇/章/课时分组。骨架是扁平数组（靠 level + parentId 表层级），
 * 渲染前先归拢成组，页面才看得出层级而不是一列平铺。
 *
 * 归拢以 `parentId` 为准：找不到父节点（骨架异常）时落到「无归属」，
 * 不硬塞给相邻的章。
 */
export function buildOutlineTree(nodes: PlanSectionNodeView[]): OutlinePartGroup[] {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const groups: OutlinePartGroup[] = []
  const groupByPartId = new Map<string, OutlinePartGroup>()
  const chapterById = new Map<string, OutlineChapterGroup>()
  let fallback: OutlinePartGroup | null = null

  const ensureFallback = (): OutlinePartGroup => {
    if (!fallback) {
      fallback = { part: null, chapters: [], loose: [] }
      groups.push(fallback)
    }
    return fallback
  }

  for (const node of nodes) {
    if (node.level === 1) {
      const group: OutlinePartGroup = { part: node, chapters: [], loose: [] }
      groups.push(group)
      groupByPartId.set(node.id, group)
      fallback = null
      continue
    }

    const parent = node.parentId ? byId.get(node.parentId) : undefined

    if (node.level === 2) {
      const group =
        (parent && parent.level === 1 ? groupByPartId.get(parent.id) : undefined) ?? ensureFallback()
      const chapter: OutlineChapterGroup = { chapter: node, lessons: [] }
      group.chapters.push(chapter)
      chapterById.set(node.id, chapter)
      continue
    }

    const chapter = parent && parent.level === 2 ? chapterById.get(parent.id) : undefined
    if (chapter) chapter.lessons.push(node)
    else ensureFallback().loose.push(node)
  }

  return groups
}

/**
 * 每个节点底下有多少课时（自己 + 所有后代）。
 * 篇与章在树里显示「N 课时」，教师一眼看出这一层有多厚。
 */
export function descendantLessonCounts(
  nodes: PlanSectionNodeView[],
): Map<string, number> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const counts = new Map<string, number>()
  const resolve = (nodeId: string): number => {
    const cached = counts.get(nodeId)
    if (cached !== undefined) return cached
    const node = byId.get(nodeId)
    let total = node?.level === 3 ? 1 : 0
    for (const childId of children.get(nodeId) ?? []) total += resolve(childId)
    counts.set(nodeId, total)
    return total
  }
  for (const node of nodes) resolve(node.id)
  return counts
}
