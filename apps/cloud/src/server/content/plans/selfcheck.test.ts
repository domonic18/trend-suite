import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_OUTLINE_NODES } from '@trend-suite/contracts'
import { checkPlanDraft, formatCheckIssues, normalizeLessonTitle, type PlanCheckInput } from './selfcheck'
import type { PlanLesson } from './tweak'

/**
 * 规划自检（迭代 8）：逐条规则一例。
 * 自检只做确定性判定——能量化的不交给模型，否则重规划会打转。
 */

type Node = PlanCheckInput['nodes'][number]

function node(id: string, title: string, level: number, parentId: string | null): Node {
  return { id, title, level, parentId }
}

/** 一份结构完整的默认输入：一篇 → 一章 → 两课时，各有出处。 */
function baseInput(overrides: Partial<PlanCheckInput> = {}): PlanCheckInput {
  const nodes: Node[] = [
    node('n1', '第一篇 趋势入门', 1, null),
    node('n2', '第一章 什么是趋势', 2, 'n1'),
    node('n3', '趋势的方向性', 3, 'n2'),
    node('n4', '趋势的级别', 3, 'n2'),
  ]
  const lessons: PlanLesson[] = [
    {
      id: 'l1',
      sectionId: 'n3',
      title: '趋势的方向性',
      subLessonCount: 2,
      estimatedMinutes: 9,
      parallelSlot: 1,
      sourceUnitIds: ['su_1'],
    },
    {
      id: 'l2',
      sectionId: 'n4',
      title: '趋势的级别',
      subLessonCount: 2,
      estimatedMinutes: 9,
      parallelSlot: 1,
      sourceUnitIds: ['su_2'],
    },
  ]
  return {
    nodes,
    unitIdsByNodeId: new Map([
      ['n3', ['su_1']],
      ['n4', ['su_2']],
    ]),
    lessons,
    knownUnitIds: new Set(['su_1', 'su_2']),
    budget: { min: 1, max: 10 },
    ...overrides,
  }
}

function codesOf(input: PlanCheckInput): string[] {
  return checkPlanDraft(input).map((issue) => issue.code)
}

test('自检：结构完整、出处齐全的方案零问题', () => {
  assert.deepEqual(codesOf(baseInput()), [])
})

test('自检：课时没有出处判 lesson_without_source', () => {
  const input = baseInput({ unitIdsByNodeId: new Map([['n4', ['su_2']]]) })
  const issues = checkPlanDraft(input)
  const issue = issues.find((item) => item.code === 'lesson_without_source')
  assert.ok(issue)
  assert.equal(issue?.subject, '趋势的方向性')
  // 目录侧报一次（分节计划侧有出处，不重复报）
  assert.equal(issues.filter((item) => item.code === 'lesson_without_source').length, 1)
})

test('自检：引用了不在输入清单里的证据单元判 unknown_source_unit', () => {
  const input = baseInput({
    unitIdsByNodeId: new Map([
      ['n3', ['su_1']],
      ['n4', ['su_ghost']],
    ]),
    knownUnitIds: new Set(['su_1', 'su_2']),
  })
  assert.ok(codesOf(input).includes('unknown_source_unit'))
})

test('自检：课时数超出素材推导区间判 lesson_count_out_of_range', () => {
  const input = baseInput({ budget: { min: 5, max: 8 } })
  const issue = checkPlanDraft(input).find((item) => item.code === 'lesson_count_out_of_range')
  assert.ok(issue)
  assert.ok(issue?.message.includes('2'))
  assert.ok(issue?.message.includes('5～8'))
})

test('自检：课时数少于下限同样判越界', () => {
  const input = baseInput({ budget: { min: 5, max: 8 } })
  assert.ok(codesOf(input).includes('lesson_count_out_of_range'))
})

test('自检：规模区间为 null 时不查规模', () => {
  const input = baseInput({ budget: null })
  assert.ok(!codesOf(input).includes('lesson_count_out_of_range'))
})

test('自检：章下没有课时判 empty_chapter', () => {
  const input = baseInput({ nodes: [node('n1', '第一篇 趋势入门', 1, null), node('n2', '第一章 什么是趋势', 2, 'n1')] })
  assert.ok(codesOf(input).includes('empty_chapter'))
})

test('自检：篇下没有章判 empty_part', () => {
  const input = baseInput({ nodes: [node('n1', '第一篇 趋势入门', 1, null)] })
  assert.ok(codesOf(input).includes('empty_part'))
})

test('自检：章没有归属的篇判 orphan_node', () => {
  const input = baseInput({
    nodes: [
      node('n1', '第一篇 趋势入门', 1, null),
      node('n2', '第一章 什么是趋势', 2, 'n_missing'),
      node('n3', '趋势的方向性', 3, 'n2'),
    ],
  })
  const issue = checkPlanDraft(input).find((item) => item.code === 'orphan_node')
  assert.ok(issue)
  assert.ok(issue?.message.includes('什么是趋势'))
})

test('自检：课时没有归属的章判 orphan_node', () => {
  const input = baseInput({
    nodes: [
      node('n1', '第一篇 趋势入门', 1, null),
      node('n2', '第一章 什么是趋势', 2, 'n1'),
      node('n3', '趋势的方向性', 3, 'n_missing'),
    ],
  })
  assert.ok(codesOf(input).includes('orphan_node'))
})

test('自检：同级课时标题重复判 duplicate_lesson_title', () => {
  const input = baseInput({
    nodes: [
      node('n1', '第一篇 趋势入门', 1, null),
      node('n2', '第一章 什么是趋势', 2, 'n1'),
      node('n3', '趋势的方向性', 3, 'n2'),
      node('n4', '1. 趋势的方向性', 3, 'n2'),
    ],
  })
  const issue = checkPlanDraft(input).find((item) => item.code === 'duplicate_lesson_title')
  assert.ok(issue)
  // 编号前缀与标点归一后才算重复
  assert.ok(issue?.message.includes('重复'))
})

test('自检：目录标题与分节计划标题同名不算重复（各组自查）', () => {
  const input = baseInput()
  assert.ok(!codesOf(input).includes('duplicate_lesson_title'))
})

test('自检：空话标题判 vague_lesson_title', () => {
  const input = baseInput({
    nodes: [
      node('n1', '第一篇 趋势入门', 1, null),
      node('n2', '第一章 什么是趋势', 2, 'n1'),
      node('n3', '本章小结', 3, 'n2'),
      node('n4', '趋势的级别', 3, 'n2'),
    ],
  })
  const issue = checkPlanDraft(input).find((item) => item.code === 'vague_lesson_title')
  assert.ok(issue)
  assert.equal(issue?.subject, '本章小结')
})

test('自检：分节计划里的空话标题同样判 vague_lesson_title', () => {
  const input = baseInput({
    lessons: [
      {
        id: 'l1',
        sectionId: 'n3',
        title: '概述',
        subLessonCount: 2,
        estimatedMinutes: 9,
        parallelSlot: 1,
        sourceUnitIds: ['su_1'],
      },
    ],
  })
  assert.ok(codesOf(input).includes('vague_lesson_title'))
})

test('自检：节点数超上限判 too_many_nodes', () => {
  const nodes: Node[] = []
  for (let i = 0; i <= MAX_OUTLINE_NODES; i += 1) nodes.push(node(`x${i}`, `课时${i}`, 3, null))
  const input = baseInput({ nodes })
  assert.ok(codesOf(input).includes('too_many_nodes'))
})

test('自检：分节计划没有出处判 lesson_without_source', () => {
  const input = baseInput({
    lessons: [
      {
        id: 'l1',
        sectionId: 'n3',
        title: '趋势的方向性',
        subLessonCount: 2,
        estimatedMinutes: 9,
        parallelSlot: 1,
        sourceUnitIds: [],
      },
    ],
  })
  assert.ok(codesOf(input).includes('lesson_without_source'))
})

test('自检：课时没有挂到目录节点上判 lesson_unattached', () => {
  const input = baseInput({
    lessons: [
      {
        id: 'l1',
        sectionId: 'n_gone',
        title: '趋势的方向性',
        subLessonCount: 2,
        estimatedMinutes: 9,
        parallelSlot: 1,
        sourceUnitIds: ['su_1'],
      },
    ],
  })
  const issue = checkPlanDraft(input).find((item) => item.code === 'lesson_unattached')
  assert.ok(issue)
  assert.equal(issue?.subject, '趋势的方向性')
})

test('自检：课时没有 sectionId 也判 lesson_unattached', () => {
  const input = baseInput({
    lessons: [
      {
        id: 'l1',
        sectionId: null,
        title: '趋势的方向性',
        subLessonCount: 2,
        estimatedMinutes: 9,
        parallelSlot: 1,
        sourceUnitIds: ['su_1'],
      },
    ],
  })
  assert.ok(codesOf(input).includes('lesson_unattached'))
})

test('自检：分节计划课时数与目录课时数不一致判 lesson_count_mismatch', () => {
  const input = baseInput({
    lessons: [
      {
        id: 'l1',
        sectionId: 'n3',
        title: '趋势的方向性',
        subLessonCount: 2,
        estimatedMinutes: 9,
        parallelSlot: 1,
        sourceUnitIds: ['su_1'],
      },
    ],
  })
  const issue = checkPlanDraft(input).find((item) => item.code === 'lesson_count_mismatch')
  assert.ok(issue)
  assert.ok(issue?.message.includes('1'))
  assert.ok(issue?.message.includes('2'))
})

test('自检：课时数与目录一致时不报数量不符', () => {
  assert.ok(!codesOf(baseInput()).includes('lesson_count_mismatch'))
})

test('normalizeLessonTitle：去编号前缀、去标点、大小写归一', () => {
  assert.equal(normalizeLessonTitle('1. 趋势的方向性'), '趋势的方向性')
  assert.equal(normalizeLessonTitle('第 1 章 趋势'), '趋势')
  assert.equal(normalizeLessonTitle('趋势（入门）'), '趋势入门')
  assert.equal(normalizeLessonTitle('Trend'), 'trend')
})

test('formatCheckIssues：逐条一行带错误码，可直接回喂模型', () => {
  const text = formatCheckIssues([
    { code: 'lesson_without_source', subject: '趋势的方向性', message: '课时「趋势的方向性」没有绑定任何证据单元' },
    { code: 'empty_chapter', subject: '第一章', message: '章「第一章」下面没有课时' },
  ])
  const lines = text.split('\n')
  assert.equal(lines.length, 2)
  assert.ok(lines[0]?.startsWith('- [lesson_without_source]'))
  assert.ok(lines[1]?.startsWith('- [empty_chapter]'))
})
