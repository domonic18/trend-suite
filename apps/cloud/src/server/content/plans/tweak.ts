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

export type PlanLesson = {
  id: string
  sectionId: string | null
  title: string
  subLessonCount: number
  estimatedMinutes: number
  parallelSlot: number
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
              { ...node, matchScore: null, matchStatus: 'ok' as const },
            ],
          },
        },
        outline: appended.outline,
      }
    }
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
