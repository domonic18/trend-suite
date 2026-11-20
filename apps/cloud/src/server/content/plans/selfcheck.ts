import 'server-only'
import {
  MAX_OUTLINE_NODES,
  type CourseOutlineView,
  type PlanCheckIssueView,
} from '@trend-suite/contracts'
import { lessonNodesOf } from './lessons'
import { normalizeLessonTitle } from './titles'
import type { PlanLesson } from './tweak'

export { normalizeLessonTitle }

/**
 * 规划自检（迭代 8，纯函数）：智能规划产出后逐条核对，**不通过就不呈现给教师**。
 *
 * 自检只做确定性规则——能量化的不交给模型判：
 * - 出处：每个课时必须绑定证据单元，且单元在本次输入清单里；
 * - 规模：课时数落在素材推导的区间内；
 * - 层级：篇下有章、章下有课时，不许断链、不许空章空篇；
 * - 粒度：课时标题不重复、不写空话。
 *
 * 失败项既能回喂给模型重规划，也能给教师看（转人工时列清楚）。
 */

export type PlanCheckInput = {
  /** 目录树（篇 / 章 / 课时三级）。 */
  nodes: CourseOutlineView['nodes']
  /** 节点绑定的证据单元（智能规划按教学要点绑定）。 */
  unitIdsByNodeId: Map<string, string[]>
  /** 分节计划。 */
  lessons: PlanLesson[]
  /** 本次输入清单里的证据单元 id——不在清单里的出处无效。 */
  knownUnitIds: Set<string>
  /** 规模区间（由素材推导）；null 表示不查规模。 */
  budget: { min: number; max: number } | null
}

/** 空话标题黑名单：这些标题不是知识点，自检判失败让模型重写。 */
const VAGUE_TITLES = new Set([
  '概述',
  '简介',
  '介绍',
  '总结',
  '小结',
  '绪论',
  '前言',
  '引言',
  '导论',
  '总览',
  '回顾',
  '复习',
  '作业',
  '目录',
  '课程介绍',
  '课程概述',
  '本节小结',
  '本章小结',
  '谢谢',
])

/** 标题归一：去编号前缀、去空白与标点——「1. 趋势是什么」与「趋势是什么」算同一个。 */

function isVagueTitle(title: string): boolean {
  const normalized = normalizeLessonTitle(title)
  if (normalized.length === 0) return true
  if (VAGUE_TITLES.has(normalized)) return true
  return normalized.endsWith('小结')
}

/** 目录树 → 父到子的子节点表（保持原有顺序）。 */
function childrenOf(nodes: CourseOutlineView['nodes']): Map<string, string[]> {
  const children = new Map<string, string[]>()
  for (const node of nodes) {
    if (!node.parentId) continue
    const list = children.get(node.parentId) ?? []
    list.push(node.id)
    children.set(node.parentId, list)
  }
  return children
}

/**
 * 规划自检：返回失败项列表（空数组 = 通过）。
 *
 * 只在智能规划下有意义——沿用人工目录时目录是教师的先验，自检无权否决，
 * 只在 Agent 产出的目录上把关。
 */
export function checkPlanDraft(input: PlanCheckInput): PlanCheckIssueView[] {
  const issues: PlanCheckIssueView[] = []
  const byId = new Map(input.nodes.map((node) => [node.id, node]))
  const children = childrenOf(input.nodes)

  if (input.nodes.length > MAX_OUTLINE_NODES) {
    issues.push({
      code: 'too_many_nodes',
      subject: '目录规模',
      message: `目录共 ${input.nodes.length} 个节点，超过上限 ${MAX_OUTLINE_NODES}`,
    })
  }

  const lessonNodes = input.nodes.filter((node) => node.level === 3)

  // 规模：课时数必须落在素材推导的区间内（太少 = 素材没覆盖够）。
  if (input.budget) {
    const count = lessonNodes.length
    if (count < input.budget.min || count > input.budget.max) {
      issues.push({
        code: 'lesson_count_out_of_range',
        subject: '规划规模',
        message: `课时数 ${count} 不在素材推导的区间 ${input.budget.min}～${input.budget.max} 内`,
      })
    }
  }

  // 层级：章要有父篇、课时要有父章；篇下有章、章下有课时。
  for (const node of input.nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (node.level === 2 && (!parent || parent.level !== 1)) {
      issues.push({
        code: 'orphan_node',
        subject: node.title,
        message: `章「${node.title}」没有归属的篇`,
      })
    }
    if (node.level === 3 && (!parent || parent.level !== 2)) {
      issues.push({
        code: 'orphan_node',
        subject: node.title,
        message: `课时「${node.title}」没有归属的章`,
      })
    }
    if (node.level === 1 && (children.get(node.id) ?? []).length === 0) {
      issues.push({
        code: 'empty_part',
        subject: node.title,
        message: `篇「${node.title}」下面没有章`,
      })
    }
    if (node.level === 2 && (children.get(node.id) ?? []).length === 0) {
      issues.push({
        code: 'empty_chapter',
        subject: node.title,
        message: `章「${node.title}」下面没有课时`,
      })
    }
  }

  // 挂靠：分节计划的每条课时都要挂到目录节点上（课时以目录为准）。
  const nodeIds = new Set(input.nodes.map((node) => node.id))
  for (const lesson of input.lessons) {
    if (lesson.sectionId && nodeIds.has(lesson.sectionId)) continue
    issues.push({
      code: 'lesson_unattached',
      subject: lesson.title,
      message: `分节计划「${lesson.title}」没有挂到目录节点上`,
    })
  }

  // 数量：分节计划的课时数要与目录里的课时数一致。
  const expectedLessons = lessonNodesOf({ nodes: input.nodes }).length
  if (input.lessons.length !== expectedLessons) {
    issues.push({
      code: 'lesson_count_mismatch',
      subject: '分节计划',
      message: `分节计划有 ${input.lessons.length} 条课时，目录里有 ${expectedLessons} 个课时节点`,
    })
  }

  // 出处：每个课时必须绑定证据单元，且单元在本次输入清单里。
  for (const node of lessonNodes) {
    const ids = input.unitIdsByNodeId.get(node.id) ?? []
    if (ids.length === 0) {
      issues.push({
        code: 'lesson_without_source',
        subject: node.title,
        message: `课时「${node.title}」没有绑定任何证据单元`,
      })
      continue
    }
    const unknown = ids.filter((id) => !input.knownUnitIds.has(id))
    if (unknown.length > 0) {
      issues.push({
        code: 'unknown_source_unit',
        subject: node.title,
        message: `课时「${node.title}」引用了 ${unknown.length} 个不存在的证据单元`,
      })
    }
  }
  for (const lesson of input.lessons) {
    if (lesson.sourceUnitIds.length === 0) {
      issues.push({
        code: 'lesson_without_source',
        subject: lesson.title,
        message: `分节计划「${lesson.title}」没有绑定任何证据单元`,
      })
      continue
    }
    const unknown = lesson.sourceUnitIds.filter((id) => !input.knownUnitIds.has(id))
    if (unknown.length > 0) {
      issues.push({
        code: 'unknown_source_unit',
        subject: lesson.title,
        message: `分节计划「${lesson.title}」引用了 ${unknown.length} 个不存在的证据单元`,
      })
    }
  }

  // 标题：重复与空话（目录与分节计划各自成组查——两边的标题本来就该一致，
  // 跨组比对会把「同名同内容」误判成重复）。
  for (const group of [lessonNodes.map((node) => node.title), input.lessons.map((l) => l.title)]) {
    const seen = new Map<string, string>()
    for (const subject of group) {
      const normalized = normalizeLessonTitle(subject)
      if (normalized.length === 0) continue
      const first = seen.get(normalized)
      if (first) {
        issues.push({
          code: 'duplicate_lesson_title',
          subject,
          message: `课时标题「${first}」与「${subject}」重复`,
        })
      } else {
        seen.set(normalized, subject)
      }
    }
  }
  for (const subject of [...lessonNodes.map((node) => node.title), ...input.lessons.map((l) => l.title)]) {
    if (isVagueTitle(subject)) {
      issues.push({
        code: 'vague_lesson_title',
        subject,
        message: `课时标题「${subject}」是空话，要写成一个可独立讲清的知识点`,
      })
    }
  }

  return issues
}

/** 失败项 → 回喂给模型的修改指令（每条一行，带可据以改写的具体信息）。 */
export function formatCheckIssues(issues: PlanCheckIssueView[]): string {
  return issues.map((issue) => `- [${issue.code}] ${issue.message}`).join('\n')
}
