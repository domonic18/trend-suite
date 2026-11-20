import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CourseOutlineView } from '@trend-suite/contracts'
import { buildLessonsFromOutline, lessonNodesOf, type ModelLesson } from './lessons'
import type { PlanningUnit } from './planning'

/**
 * 分节计划以目录为准（需求 T6 目录先验）：
 * 课时标题取教师原文、模型改名不算数；出处挂在课时上，估时按真实跨度。
 */

const OUTLINE: CourseOutlineView = {
  nodes: [
    { id: 'n1', title: '第一篇 交易认知的反思与选择', level: 1, parentId: null },
    { id: 'n2', title: '第一章 趋势的本质', level: 2, parentId: 'n1' },
    { id: 'n3', title: '1. 趋势包含方向与能量', level: 3, parentId: 'n2' },
    { id: 'n4', title: '2. 股票是周期加趋势', level: 3, parentId: 'n2' },
  ],
}

function unit(id: string, startMs: number, endMs: number, points: string[]): PlanningUnit {
  return { id, assetId: 'ast_1', assetName: '第一讲.mp4', startMs, endMs, points }
}

function modelLesson(overrides: Partial<ModelLesson> = {}): ModelLesson {
  return {
    sectionId: null,
    title: '',
    subLessonCount: 1,
    estimatedMinutes: 10,
    parallelSlot: 1,
    sourceUnitIds: [],
    ...overrides,
  }
}

test('lessonNodesOf：有三级节点用三级；只有篇/章时用叶子节点', () => {
  assert.deepEqual(
    lessonNodesOf(OUTLINE).map((node) => node.id),
    ['n3', 'n4'],
  )
  const flat: CourseOutlineView = {
    nodes: [
      { id: 'n1', title: '第一篇 总论', level: 1, parentId: null },
      { id: 'n2', title: '第一章 什么是趋势', level: 2, parentId: 'n1' },
    ],
  }
  assert.deepEqual(
    lessonNodesOf(flat).map((node) => node.id),
    ['n2'],
  )
})

test('课时标题取教师原文：模型改名不算数', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [
      modelLesson({ sectionId: 'n3', title: '趋势的玄学解释', sourceUnitIds: ['su_1'] }),
      modelLesson({ sectionId: 'n4', title: '周期与趋势的叠加', sourceUnitIds: ['su_2'] }),
    ],
    units: [unit('su_1', 0, 600_000, ['趋势有方向']), unit('su_2', 600_000, 1_200_000, ['周期加趋势'])],
    knownUnitIds: new Set(['su_1', 'su_2']),
  })
  assert.deepEqual(
    built.lessons.map((lesson) => lesson.title),
    ['趋势包含方向与能量', '股票是周期加趋势'],
  )
  assert.deepEqual(
    built.lessons.map((lesson) => lesson.sectionId),
    ['n3', 'n4'],
  )
})

test('模型 sectionId 为空时按标题回挂', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [modelLesson({ sectionId: null, title: '1. 趋势包含方向与能量', sourceUnitIds: ['su_1'] })],
    units: [unit('su_1', 0, 600_000, ['趋势有方向'])],
    knownUnitIds: new Set(['su_1']),
  })
  assert.equal(built.lessons[0]?.sectionId, 'n3')
  assert.deepEqual(built.lessons[0]?.sourceUnitIds, ['su_1'])
})

test('模型给的课时不在目录里：剔除并留痕（已自动处理，不阻塞批准）', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [modelLesson({ sectionId: 'n99', title: '模型自编的一节', sourceUnitIds: ['su_1'] })],
    units: [unit('su_1', 0, 600_000, ['趋势有方向'])],
    knownUnitIds: new Set(['su_1']),
  })
  assert.equal(built.lessons.length, 2)
  assert.equal(built.violations.length, 1)
  assert.equal(built.violations[0]?.resolved, true)
})

test('估时按绑定单元的真实跨度，没有 5 分钟地板', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [
      modelLesson({ sectionId: 'n3', title: '趋势包含方向与能量', sourceUnitIds: ['su_1'] }),
      modelLesson({ sectionId: 'n4', title: '股票是周期加趋势', sourceUnitIds: ['su_2'] }),
    ],
    units: [unit('su_1', 0, 60_000, ['趋势有方向']), unit('su_2', 600_000, 1_200_000, ['周期加趋势'])],
    knownUnitIds: new Set(['su_1', 'su_2']),
  })
  // 一分钟素材就是一分钟的课——不是模型拍，也不是地板 5 分钟
  assert.equal(built.lessons[0]?.estimatedMinutes, 1)
  assert.equal(built.lessons[1]?.estimatedMinutes, 10)
})

test('没有出处时取模型的估值，参数仍钳在契约区间内', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [
      modelLesson({
        sectionId: 'n3',
        title: '趋势包含方向与能量',
        subLessonCount: 99,
        parallelSlot: 9,
        estimatedMinutes: 30,
      }),
    ],
    units: [],
    knownUnitIds: new Set(),
  })
  assert.equal(built.lessons[0]?.subLessonCount, 20)
  assert.equal(built.lessons[0]?.parallelSlot, 8)
  assert.equal(built.lessons[0]?.estimatedMinutes, 30)
})

test('粒度没有模型提示时由要点数推导', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [],
    units: [unit('su_1', 0, 600_000, ['甲', '乙', '丙'])],
    knownUnitIds: new Set(['su_1']),
    unitIdsByNodeId: new Map([['n3', ['su_1']]]),
  })
  assert.equal(built.lessons[0]?.subLessonCount, 3)
})

test('模型把出处挂在章上：摊到该章下的课时', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [modelLesson({ sectionId: 'n2', title: '第一章 趋势的本质', sourceUnitIds: ['su_1'] })],
    units: [unit('su_1', 0, 600_000, ['趋势有方向'])],
    knownUnitIds: new Set(['su_1']),
  })
  assert.deepEqual(built.lessons[0]?.sourceUnitIds, ['su_1'])
  assert.deepEqual(built.violations[0]?.resolved, true)
})

test('引用了不在清单里的证据单元：剔除，只留已处理的痕迹', () => {
  const built = buildLessonsFromOutline({
    outline: OUTLINE,
    modelLessons: [
      modelLesson({ sectionId: 'n3', title: '趋势包含方向与能量', sourceUnitIds: ['su_1', 'su_ghost'] }),
    ],
    units: [unit('su_1', 0, 600_000, ['趋势有方向'])],
    knownUnitIds: new Set(['su_1']),
  })
  assert.deepEqual(built.lessons[0]?.sourceUnitIds, ['su_1'])
})
