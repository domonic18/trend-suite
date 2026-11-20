import 'server-only'
import {
  type CourseOutlineView,
  type PlanConceptMapView,
  type PlanGlossaryView,
  type PlanSkeletonView,
  type PlanViolationView,
  type TweakPlanRequest,
} from '@trend-suite/contracts'
import { badRequest, conflict } from '@/server/lib/http'
import { appendOutlineNode, isLeafNode } from './outline'

/**
 * 结构化微调（arch/05 §5 门禁①）：教师直接改草案，不走 LLM、即时生效。
 * 纯函数：入参当前草案内容 + 操作 + 目录树，出参新草案内容（add_chapter
 * 会同步更新目录树，保证「骨架 ⊆ 目录」不变量）。
 */

/** 目录树节点（契约 zod 口径：level 是 number）。 */
type OutlineEntry = CourseOutlineView['nodes'][number]

export type PlanLesson = {
  id: string
  sectionId: string | null
  title: string
  subLessonCount: number
  estimatedMinutes: number
  parallelSlot: number
  /** 该课时覆盖的证据单元（source_units.id）——一课时 = 一个可独立讲清的知识点。 */
  sourceUnitIds: string[]
}

export type TweakedContent = {
  skeleton: PlanSkeletonView
  conceptMap: PlanConceptMapView
  glossary: PlanGlossaryView
  sectionPlan: { lessons: PlanLesson[] }
  violations: PlanViolationView[]
}

export function applyTweak(
  content: TweakedContent,
  op: TweakPlanRequest,
  outline: CourseOutlineView,
): { content: TweakedContent; outline: CourseOutlineView } {
  switch (op.op) {
    case 'rename_chapter':
      requireNode(content.skeleton, op.nodeId)
      return {
        content: {
          ...content,
          skeleton: {
            nodes: content.skeleton.nodes.map((node) =>
              node.id === op.nodeId ? { ...node, title: op.title } : node,
            ),
          },
        },
        outline: renameOutlineNode(outline, op.nodeId, op.title),
      }
    case 'merge_chapters':
      return mergeChapters(content, outline, op.nodeIds, op.title)
    case 'remove_chapter':
      return removeChapter(content, outline, op.nodeId)
    case 'add_chapter': {
      const appended = appendOutlineNode(outline, { parentId: op.parentId, title: op.title })
      const node = appended.node
      return {
        content: {
          ...content,
          skeleton: {
            nodes: [
              ...content.skeleton.nodes,
              // 教师主动加章：无证据属教师决策，不算未决项。
              { ...node, matchScore: null, matchStatus: 'ok' as const, sourceUnitIds: [] },
            ],
          },
        },
        outline: appended.outline,
      }
    }
    case 'move_node':
      return moveNode(content, outline, op)
    case 'reorder_lessons':
      return { content: reorderLessons(content, op.lessonIds), outline }
    case 'set_granularity': {
      if (!content.sectionPlan.lessons.some((lesson) => lesson.id === op.lessonId)) {
        throw badRequest('分节不存在')
      }
      return {
        content: {
          ...content,
          sectionPlan: {
            lessons: content.sectionPlan.lessons.map((lesson) =>
              lesson.id === op.lessonId ? { ...lesson, subLessonCount: op.subLessonCount } : lesson,
            ),
          },
        },
        outline,
      }
    }
    case 'add_alias':
      return { content: addAlias(content, op.conceptId, op.alias), outline }
  }
}

function requireNode(skeleton: PlanSkeletonView, nodeId: string) {
  if (!skeleton.nodes.some((node) => node.id === nodeId)) {
    throw badRequest('章节不存在或已被移除')
  }
}

/** 某节点的全部子孙 id（含间接）。 */
function descendantIds(outline: CourseOutlineView, nodeId: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const node of outline.nodes) {
    if (!node.parentId) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const out = new Set<string>()
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (out.has(child)) continue
      out.add(child)
      walk(child)
    }
  }
  walk(nodeId)
  return out
}

/**
 * 移动章节（教师微调）：换父节点 + 调同级位置。
 * 层级约束守死——篇只能在顶级、章只能挂篇、课时只能挂章；移进自己的子孙被拒。
 * 不允许把父节点搬空：空章会变成一节没有课时的生产节，比没有更糟。
 */
function moveNode(
  content: TweakedContent,
  outline: CourseOutlineView,
  op: { nodeId: string; newParentId: string | null; position: number },
): { content: TweakedContent; outline: CourseOutlineView } {
  const node = outline.nodes.find((item) => item.id === op.nodeId)
  if (!node) throw badRequest('章节不存在或已被移除')
  const parent = op.newParentId ? outline.nodes.find((item) => item.id === op.newParentId) : undefined
  if (op.newParentId && !parent) throw badRequest('目标父章节不存在')

  if (node.level === 1) {
    if (parent) throw badRequest('篇只能放在顶级')
  } else if (!parent || parent.level !== node.level - 1) {
    throw badRequest(node.level === 3 ? '课时只能放在章下' : '章只能放在篇下')
  }
  if (parent && descendantIds(outline, node.id).has(parent.id)) {
    throw badRequest('不能把章节移进它自己的下级')
  }
  // 搬空父节点会留下空章 / 空篇——那会变成没有课时的生产节，直接拒。
  const oldParentId = node.parentId
  if (oldParentId && oldParentId !== op.newParentId) {
    const siblings = outline.nodes.filter((item) => item.parentId === oldParentId)
    if (siblings.length === 1) {
      const oldParent = outline.nodes.find((item) => item.id === oldParentId)
      throw badRequest(`「${oldParent?.title ?? oldParentId}」下面只剩这一个，移走会留下空节点——先给它加内容或删掉它`)
    }
  }

  const moved = reorderOutline(outline, node.id, op.newParentId, op.position)
  return {
    content: { ...content, skeleton: reorderSkeleton(content.skeleton, moved) },
    outline: moved,
  }
}

/**
 * 目录树重排：把节点摘出来插到新父节点下的指定位置，再按「先父后子」的
 * 文档顺序铺平。节点 id 不变（骨架与分节计划靠 id 挂靠）。
 */
function reorderOutline(
  outline: CourseOutlineView,
  nodeId: string,
  newParentId: string | null,
  position: number,
): CourseOutlineView {
  const byId = new Map(outline.nodes.map((node) => [node.id, node]))
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const node of outline.nodes) {
    if (!node.parentId) {
      roots.push(node.id)
      continue
    }
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  const current = byId.get(nodeId)
  if (!current) throw badRequest('章节不存在或已被移除')
  const oldParentId = current.parentId
  const node: OutlineEntry = { ...current, parentId: newParentId }
  byId.set(nodeId, node)

  // 摘出来
  if (oldParentId) {
    children.set(
      oldParentId,
      (children.get(oldParentId) ?? []).filter((id) => id !== nodeId),
    )
  } else {
    const at = roots.indexOf(nodeId)
    if (at >= 0) roots.splice(at, 1)
  }
  // 插到新位置
  if (newParentId) {
    const list = children.get(newParentId) ?? []
    const at = Math.min(Math.max(position, 0), list.length)
    list.splice(at, 0, nodeId)
    children.set(newParentId, list)
  } else {
    const at = Math.min(Math.max(position, 0), roots.length)
    roots.splice(at, 0, nodeId)
  }

  // 铺平：先父后子，文档顺序
  const ordered: OutlineEntry[] = []
  const emitted = new Set<string>()
  const emit = (id: string) => {
    const entry = byId.get(id)
    if (!entry || emitted.has(id)) return
    emitted.add(id)
    ordered.push(entry)
    for (const child of children.get(id) ?? []) emit(child)
  }
  for (const root of roots) emit(root)
  // 兜底：孤儿节点（父节点不在树里）不能丢，追加在末尾
  for (const item of outline.nodes) {
    if (!emitted.has(item.id)) {
      emitted.add(item.id)
      ordered.push(item)
    }
  }
  return { nodes: ordered }
}

/** 骨架跟着目录树重排：父节点与顺序同步，id 不变。 */
function reorderSkeleton(
  skeleton: PlanSkeletonView,
  outline: CourseOutlineView,
): PlanSkeletonView {
  const byId = new Map(skeleton.nodes.map((node) => [node.id, node]))
  const outlineIds = new Set(outline.nodes.map((node) => node.id))
  const ordered = outline.nodes.flatMap((node) => {
    const entry = byId.get(node.id)
    if (!entry) return []
    return [{ ...entry, level: node.level, parentId: node.parentId }]
  })
  // 目录里没有的骨架节点不丢（异常数据兜底），追加在末尾。
  const rest = skeleton.nodes.filter((node) => !outlineIds.has(node.id))
  return { nodes: [...ordered, ...rest] }
}

/** 分节计划重排：课时顺序必须是现有课时的全排列。 */
function reorderLessons(content: TweakedContent, lessonIds: string[]): TweakedContent {
  const lessons = content.sectionPlan.lessons
  const existing = new Set(lessons.map((lesson) => lesson.id))
  const given = new Set(lessonIds)
  if (given.size !== existing.size || [...existing].some((id) => !given.has(id))) {
    throw badRequest('课时顺序必须是现有课时的全排列')
  }
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson]))
  return {
    ...content,
    sectionPlan: {
      lessons: lessonIds.map((id) => byId.get(id)!).filter((lesson) => lesson !== undefined),
    },
  }
}

function mergeChapters(
  content: TweakedContent,
  outline: CourseOutlineView,
  nodeIds: string[],
  title: string,
): { content: TweakedContent; outline: CourseOutlineView } {
  const first = content.skeleton.nodes.find((node) => node.id === nodeIds[0])
  if (!first) throw badRequest('章节不存在或已被移除')
  if (content.skeleton.nodes.some((node) => nodeIds.includes(node.id) && node.parentId !== first.parentId)) {
    throw badRequest('只能合并同一父章节下的章节')
  }
  for (const id of nodeIds) {
    if (!isLeafNode(outline, id)) throw badRequest('只能合并没有子章节的章节')
  }
  const keepId = nodeIds[0]!
  const dropped = new Set(nodeIds.slice(1))
  return {
    content: {
      ...content,
      skeleton: {
        nodes: content.skeleton.nodes
          .filter((node) => !dropped.has(node.id))
          .map((node) => (node.id === keepId ? { ...node, title } : node)),
      },
      sectionPlan: {
        lessons: content.sectionPlan.lessons.map((lesson) =>
          lesson.sectionId && dropped.has(lesson.sectionId)
            ? { ...lesson, sectionId: keepId }
            : lesson,
        ),
      },
    },
    outline: {
      nodes: outline.nodes
        .filter((node) => !dropped.has(node.id))
        .map((node) => (node.id === keepId ? { ...node, title } : node)),
    },
  }
}

function removeChapter(
  content: TweakedContent,
  outline: CourseOutlineView,
  nodeId: string,
): { content: TweakedContent; outline: CourseOutlineView } {
  requireNode(content.skeleton, nodeId)
  if (!isLeafNode(outline, nodeId)) throw badRequest('该章节有子章节，请先处理子章节')
  return {
    content: {
      ...content,
      skeleton: { nodes: content.skeleton.nodes.filter((node) => node.id !== nodeId) },
      sectionPlan: {
        lessons: content.sectionPlan.lessons.map((lesson) =>
          lesson.sectionId === nodeId ? { ...lesson, sectionId: null } : lesson,
        ),
      },
    },
    outline: { nodes: outline.nodes.filter((node) => node.id !== nodeId) },
  }
}

function addAlias(content: TweakedContent, conceptId: string, alias: string): TweakedContent {
  const concept = content.conceptMap.concepts.find((entry) => entry.id === conceptId)
  if (!concept) throw badRequest('概念不存在')
  if (concept.aliases.includes(alias)) return content
  if (concept.aliases.length >= 20) throw badRequest('每个概念最多 20 个别名')
  const clashing = content.conceptMap.concepts.find(
    (entry) => entry.id !== conceptId && (entry.name === alias || entry.aliases.includes(alias)),
  )
  if (clashing) {
    throw conflict(`别名「${alias}」与概念「${clashing.name}」冲突`)
  }
  const concepts = content.conceptMap.concepts.map((entry) =>
    entry.id === conceptId ? { ...entry, aliases: [...entry.aliases, alias] } : entry,
  )
  return {
    ...content,
    // 术语表与概念图谱同源：别名变更同步词条。
    conceptMap: { ...content.conceptMap, concepts },
    glossary: {
      items: content.glossary.items.map((item) =>
        item.term === concept.name ? { ...item, aliases: [...item.aliases, alias] } : item,
      ),
    },
  }
}

function renameOutlineNode(outline: CourseOutlineView, nodeId: string, title: string): CourseOutlineView {
  return {
    nodes: outline.nodes.map((node) => (node.id === nodeId ? { ...node, title } : node)),
  }
}
