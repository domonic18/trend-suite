import 'server-only'
import {
  stripOutlineNumbering,
  type CourseOutlineView,
  type PlanViolationView,
} from '@trend-suite/contracts'
import { spanMinutesOf, subLessonCountOf, type PlanningUnit } from './planning'
import { normalizeLessonTitle } from './titles'
import type { PlanLesson } from './tweak'

/**
 * 分节计划以目录为准（需求 T6「目录先验」）：
 *
 * 课时不是模型发明的——每个课时级目录节点就是一条课时，标题取教师原文。
 * 模型只提供「这条课时覆盖哪些证据单元、粒度多细、并行槽位」这些挂靠信息。
 *
 * 这样模型改名、改结构都影响不了骨架：目录是下界，方案只能在其上挂出处。
 */

/** 模型给出的课时（起草器产物，字段与 draftOutputSchema.lessons 一致）。 */
export type ModelLesson = {
  sectionId: string | null
  title: string
  subLessonCount: number
  estimatedMinutes: number
  parallelSlot: number
  sourceUnitIds: string[]
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

/**
 * 课时对应的目录节点：有三级节点就用三级；
 * 教师只给了篇/章（没有课时级）时用叶子节点——叶子即九步生产的一节。
 */
export function lessonNodesOf(outline: CourseOutlineView): CourseOutlineView['nodes'] {
  const level3 = outline.nodes.filter((node) => node.level === 3)
  if (level3.length > 0) return level3
  const parents = new Set(outline.nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])))
  return outline.nodes.filter((node) => !parents.has(node.id))
}

/** 证据单元 id → 该单元的要点（估时与粒度用）。 */
function pointsOf(units: PlanningUnit[], unitIds: string[]): string[] {
  const wanted = new Set(unitIds)
  return units.filter((unit) => wanted.has(unit.id)).flatMap((unit) => unit.points)
}

/**
 * 目录 + 模型的挂靠信息 → 分节计划。
 *
 * 挂靠优先级：模型的 sectionId → 归一标题相同（模型 sectionId 为空时按标题回挂）。
 * 模型把出处挂在章/篇上时按顺序摊到该节点下的课时（章的证据就是这些课时的证据）；
 * 完全挂不上的模型课时剔除并留痕（已自动处理，不阻塞批准）。
 */
export function buildLessonsFromOutline(input: {
  outline: CourseOutlineView
  modelLessons: ModelLesson[]
  units: PlanningUnit[]
  knownUnitIds: Set<string>
  /** 目录草案里已绑定的出处（智能规划代拟目录时给出）：节点 id → 证据单元 id。 */
  unitIdsByNodeId?: Map<string, string[]>
}): {
  lessons: PlanLesson[]
  violations: PlanViolationView[]
  /** 节点 → 证据单元 id（课时节点上是这条课时的出处）。 */
  unitIdsByNodeId: Map<string, string[]>
} {
  const { outline, modelLessons, units, knownUnitIds } = input
  const nodes = lessonNodesOf(outline)
  const lessonNodeIds = new Set(nodes.map((node) => node.id))
  const knownNodeIds = new Set(outline.nodes.map((node) => node.id))
  const unitIdsByNodeId = new Map<string, string[]>(input.unitIdsByNodeId ?? [])

  const bySection = new Map<string, ModelLesson[]>()
  const byTitle = new Map<string, ModelLesson[]>()
  modelLessons.forEach((lesson) => {
    if (lesson.sectionId && knownNodeIds.has(lesson.sectionId)) {
      const list = bySection.get(lesson.sectionId) ?? []
      list.push(lesson)
      bySection.set(lesson.sectionId, list)
    }
    const key = normalizeLessonTitle(lesson.title)
    if (key.length > 0) {
      const list = byTitle.get(key) ?? []
      list.push(lesson)
      byTitle.set(key, list)
    }
  })

  const used = new Set<number>()
  const violations: PlanViolationView[] = []
  /** 每条课时对应的模型课时（没有则粒度由要点数推导）。 */
  const modelOf: (ModelLesson | undefined)[] = []

  // 模型挂到章/篇上的出处：摊给该节点下的课时（章的证据就是这些课时的证据）。
  const spreadUnits = new Map<string, string[]>()
  const lessons: PlanLesson[] = []

  nodes.forEach((node, index) => {
    const candidates = [
      ...(bySection.get(node.id) ?? []),
      ...(byTitle.get(normalizeLessonTitle(node.title)) ?? []),
    ]
    const model = candidates.find((lesson) => !used.has(modelLessons.indexOf(lesson)))
    if (model) used.add(modelLessons.indexOf(model))

    // 出处 = 目录草案里已绑的 ∪ 模型挂的（只认本次输入清单里的单元）。
    const drafted = (unitIdsByNodeId.get(node.id) ?? []).filter((id) => knownUnitIds.has(id))
    const fromModel = (model?.sourceUnitIds ?? []).filter((id) => knownUnitIds.has(id))
    const boundIds = [...new Set([...drafted, ...fromModel])]

    const points = pointsOf(units, boundIds)
    const title = stripOutlineNumbering(node.title) || node.title
    modelOf.push(model)
    lessons.push({
      id: `l${index + 1}`,
      sectionId: node.id,
      title: title.slice(0, 200),
      subLessonCount: model ? clamp(model.subLessonCount, 1, 20) : subLessonCountOf(points),
      estimatedMinutes:
        boundIds.length > 0
          ? Math.max(1, spanMinutesOf(units, boundIds))
          : clamp(model?.estimatedMinutes ?? 1, 1, 240),
      parallelSlot: model ? clamp(model.parallelSlot, 1, 8) : 1,
      sourceUnitIds: boundIds,
    })
    unitIdsByNodeId.set(node.id, boundIds)
  })

  // 挂不上的模型课时：出处摊给章下的课时，或直接剔除（留痕，不阻塞批准）。
  modelLessons.forEach((lesson, index) => {
    if (used.has(index)) return
    const unitIds = lesson.sourceUnitIds.filter((id) => knownUnitIds.has(id))
    const target = lesson.sectionId && knownNodeIds.has(lesson.sectionId) ? lesson.sectionId : null
    const children = target
      ? nodes.filter((node) => isUnder(node, target, outline.nodes))
      : []
    if (children.length > 0 && unitIds.length > 0) {
      children.forEach((child, i) => {
        const id = unitIds[i % unitIds.length]
        if (!id) return
        const list = spreadUnits.get(child.id) ?? []
        list.push(id)
        spreadUnits.set(child.id, list)
      })
      violations.push({
        kind: 'outline_violation',
        subject: lesson.title.slice(0, 40),
        reason: '模型把出处挂在章上，已摊到该章下的课时',
        resolved: true,
      })
      return
    }
    violations.push({
      kind: 'outline_violation',
      subject: lesson.title.slice(0, 40),
      reason: '模型给的课时不在目录里，已剔除（目录先验：课时以目录为准）',
      resolved: true,
    })
  })

  // 摊出来的出处并回课时（估时随之按真实跨度重算）。
  if (spreadUnits.size > 0) {
    lessons.forEach((lesson, index) => {
      const extra = spreadUnits.get(lesson.sectionId ?? '') ?? []
      if (extra.length === 0) return
      const boundIds = [...new Set([...lesson.sourceUnitIds, ...extra])]
      lesson.sourceUnitIds = boundIds
      const node = nodes.find((item) => item.id === lesson.sectionId)
      if (node) unitIdsByNodeId.set(node.id, boundIds)
      lesson.estimatedMinutes = Math.max(1, spanMinutesOf(units, boundIds))
      if (!modelOf[index]) {
        lesson.subLessonCount = subLessonCountOf(pointsOf(units, boundIds))
      }
    })
  }

  return { lessons, violations, unitIdsByNodeId }
}

/** 节点是否在某节点之下（含直接子级）。 */
function isUnder(
  node: CourseOutlineView['nodes'][number],
  ancestorId: string,
  nodes: CourseOutlineView['nodes'],
): boolean {
  let parentId = node.parentId
  while (parentId) {
    if (parentId === ancestorId) return true
    parentId = nodes.find((item) => item.id === parentId)?.parentId ?? null
  }
  return false
}
