import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '@/server/lib/http'
import { buildSkeleton, deriveMatchesFromUnits, parseOutline, trimOutlineToBudget } from './outline'
import { validateConceptMap } from './concepts'
import { applyTweak, type TweakedContent } from './tweak'

/**
 * 纯函数用例：目录先验、概念归一、结构化微调。
 * DB 侧用例见 service.test.ts（对齐验收清单）。
 */

const OUTLINE_TEXT = ['第一篇 总论', '第一章 什么是趋势', '1. 趋势的定义', '2. 级别的概念'].join('\n')

test('parseOutline：三级编号解析成目录树', () => {
  const outline = parseOutline(OUTLINE_TEXT)
  assert.equal(outline.nodes.length, 4)
  const [part, chapter, lesson1, lesson2] = outline.nodes
  assert.equal(part?.level, 1)
  assert.equal(part?.parentId, null)
  assert.equal(chapter?.parentId, part?.id)
  assert.equal(lesson1?.level, 3)
  assert.equal(lesson1?.parentId, chapter?.id)
  assert.equal(lesson2?.parentId, chapter?.id)
})

test('parseOutline：无法识别的行报 400 并带行号', () => {
  assert.throws(
    () => parseOutline('第一篇 总论\n这不是目录'),
    (err: unknown) =>
      err instanceof HttpError && err.status === 400 && err.message.includes('第 2 行'),
  )
})

test('parseOutline：空目录报 400', () => {
  assert.throws(
    () => parseOutline('   \n\n'),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('buildSkeleton：目录外章节进拒绝记录，漏掉的目录节点记低匹配', () => {
  const outline = parseOutline(OUTLINE_TEXT)
  const { skeleton, violations } = buildSkeleton(outline, [
    { nodeId: outline.nodes[0]!.id, matchScore: 0.9 },
    { nodeId: 'n99', matchScore: 0.8 },
  ])
  assert.equal(skeleton.nodes.length, 4)
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.kind, 'outline_violation')
  assert.equal(violations[0]?.subject, 'n99')
  // 目录是下界：LLM 漏掉的节点保留，且判为证据不足
  assert.equal(skeleton.nodes[1]?.matchStatus, 'low_match')
  assert.equal(skeleton.nodes[1]?.matchScore, null)
  assert.equal(skeleton.nodes[0]?.matchStatus, 'ok')
})

test('deriveMatchesFromUnits：课时有出处即算匹配，章与篇取子节点均值', () => {
  const outline = parseOutline(OUTLINE_TEXT)
  const matches = deriveMatchesFromUnits(
    outline,
    new Map([
      [outline.nodes[2]!.id, ['su_1']],
      [outline.nodes[3]!.id, ['su_2']],
    ]),
  )
  const byId = new Map(matches.map((match) => [match.nodeId, match.matchScore]))
  assert.equal(byId.get(outline.nodes[2]!.id), 1)
  assert.equal(byId.get(outline.nodes[3]!.id), 1)
  // 章：两个课时都有出处 → 1；篇：取章的均值 → 1
  assert.equal(byId.get(outline.nodes[1]!.id), 1)
  assert.equal(byId.get(outline.nodes[0]!.id), 1)
})

test('deriveMatchesFromUnits：没有出处的课时判证据不足，父章节不虚高', () => {
  const outline = parseOutline(OUTLINE_TEXT)
  const matches = deriveMatchesFromUnits(
    outline,
    new Map([[outline.nodes[2]!.id, ['su_1']]]),
  )
  const byId = new Map(matches.map((match) => [match.nodeId, match.matchScore]))
  assert.equal(byId.get(outline.nodes[2]!.id), 1)
  assert.equal(byId.get(outline.nodes[3]!.id), null)
  // 章的两个孩子只有一个有出处 → 0.5，仍是 low_match
  assert.equal(byId.get(outline.nodes[1]!.id), 0.5)
  assert.equal(byId.get(outline.nodes[0]!.id), 0.5)
})

test('trimOutlineToBudget：超上限的课时被裁掉，空章空篇一并清掉', () => {
  const outline = parseOutline(
    [
      '第一篇 总论',
      '第一章 甲',
      '1. 甲之一',
      '2. 甲之二',
      '3. 甲之三',
      '第二章 乙',
      '1. 乙之一',
      '2. 乙之二',
    ].join('\n'),
  )
  const { outline: trimmed, trimmed: dropped } = trimOutlineToBudget(outline, 3)
  assert.equal(dropped, 2)
  assert.equal(trimmed.nodes.filter((node) => node.level === 3).length, 3)
  // 第二章的课时全被裁掉 → 章也不留；第一篇还有章 → 篇留着
  assert.equal(trimmed.nodes.filter((node) => node.level === 2).length, 1)
  assert.equal(trimmed.nodes.filter((node) => node.level === 1).length, 1)
})

test('trimOutlineToBudget：没超上限时原样返回', () => {
  const outline = parseOutline(OUTLINE_TEXT)
  const { outline: trimmed, trimmed: dropped } = trimOutlineToBudget(outline, 10)
  assert.equal(dropped, 0)
  assert.equal(trimmed.nodes.length, outline.nodes.length)
})

test('validateConceptMap：重名只保留首个并留痕', () => {
  const { conceptMap, violations } = validateConceptMap({
    concepts: [
      { name: '趋势', aliases: [], definition: '价格运行方向' },
      { name: '趋势', aliases: [], definition: '重复定义' },
    ],
    edges: [],
  })
  assert.equal(conceptMap.concepts.length, 1)
  assert.equal(conceptMap.concepts[0]?.definition, '价格运行方向')
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.kind, 'concept_conflict')
})

test('validateConceptMap：别名与其它概念名撞车时剔除别名', () => {
  const { conceptMap, violations } = validateConceptMap({
    concepts: [
      { name: '均线束', aliases: ['均线组'], definition: null },
      { name: '均线组', aliases: [], definition: null },
    ],
    edges: [],
  })
  assert.equal(conceptMap.concepts.length, 2)
  assert.deepEqual(conceptMap.concepts[0]?.aliases, [])
  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.kind, 'concept_conflict')
})

test('validateConceptMap：未知名依赖边、自环与重复边被剔除', () => {
  const { conceptMap, violations } = validateConceptMap({
    concepts: [
      { name: 'A', aliases: [], definition: null },
      { name: 'B', aliases: [], definition: null },
    ],
    edges: [
      { from: 'A', to: 'B', kind: 'prerequisite' },
      { from: 'A', to: 'B', kind: 'prerequisite' },
      { from: 'A', to: 'A', kind: 'related' },
      { from: 'A', to: 'C', kind: 'related' },
    ],
  })
  assert.equal(conceptMap.edges.length, 1)
  assert.equal(violations.length, 1)
  assert.ok(violations[0]?.reason.includes('未收录'))
})

test('validateConceptMap：先修成环时环内依赖边被移除并留痕', () => {
  const { conceptMap, violations } = validateConceptMap({
    concepts: [
      { name: 'A', aliases: [], definition: null },
      { name: 'B', aliases: [], definition: null },
      { name: 'C', aliases: [], definition: null },
    ],
    edges: [
      { from: 'A', to: 'B', kind: 'prerequisite' },
      { from: 'B', to: 'C', kind: 'prerequisite' },
      { from: 'C', to: 'A', kind: 'prerequisite' },
    ],
  })
  assert.equal(conceptMap.edges.length, 0)
  assert.equal(violations.length, 1)
  assert.ok(violations[0]?.reason.includes('循环'))
})

function baseContent(): TweakedContent {
  const outline = parseOutline(OUTLINE_TEXT)
  const { skeleton } = buildSkeleton(outline, [
    { nodeId: outline.nodes[0]!.id, matchScore: 0.9 },
    { nodeId: outline.nodes[1]!.id, matchScore: 0.9 },
    { nodeId: outline.nodes[2]!.id, matchScore: 0.9 },
    { nodeId: outline.nodes[3]!.id, matchScore: 0.9 },
  ])
  return {
    skeleton,
    conceptMap: {
      concepts: [
        { id: 'cpt_1', name: '趋势', aliases: [], definition: '价格运行方向' },
        { id: 'cpt_2', name: '级别', aliases: [], definition: '时间尺度' },
      ],
      edges: [],
    },
    glossary: {
      items: [
        { term: '趋势', aliases: [], note: '价格运行方向' },
        { term: '级别', aliases: [], note: '时间尺度' },
      ],
    },
    sectionPlan: {
      lessons: [
        {
          id: 'l1',
          sectionId: outline.nodes[2]!.id,
          title: '趋势的定义',
          subLessonCount: 3,
          estimatedMinutes: 18,
          parallelSlot: 1,
          sourceUnitIds: [],
        },
      ],
    },
    violations: [],
  }
}

test('applyTweak：改名同步骨架与目录树', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  const result = applyTweak(
    content,
    { op: 'rename_chapter', nodeId: outline.nodes[1]!.id, title: '什么是趋势（修订）' },
    outline,
  )
  assert.ok(result.content.skeleton.nodes.some((node) => node.title === '什么是趋势（修订）'))
  assert.ok(result.outline.nodes.some((node) => node.title === '什么是趋势（修订）'))
})

test('applyTweak：加章同步目录树，且教师决策不算未决项', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  const result = applyTweak(
    content,
    { op: 'add_chapter', parentId: outline.nodes[1]!.id, title: '新增一节' },
    outline,
  )
  assert.equal(result.content.skeleton.nodes.length, 5)
  const added = result.content.skeleton.nodes.at(-1)
  assert.equal(added?.title, '新增一节')
  assert.equal(added?.matchStatus, 'ok')
  assert.equal(result.outline.nodes.length, 5)
})

test('applyTweak：有子章节的章不能删', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  assert.throws(
    () => applyTweak(content, { op: 'remove_chapter', nodeId: outline.nodes[1]!.id }, outline),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('applyTweak：删除章节把挂靠的分节置为未挂载', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  const result = applyTweak(
    content,
    { op: 'remove_chapter', nodeId: outline.nodes[2]!.id },
    outline,
  )
  assert.equal(result.content.skeleton.nodes.length, 3)
  assert.equal(result.content.sectionPlan.lessons[0]?.sectionId, null)
})

test('applyTweak：合并只允许同父章节下的叶子', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  const result = applyTweak(
    content,
    {
      op: 'merge_chapters',
      nodeIds: [outline.nodes[2]!.id, outline.nodes[3]!.id],
      title: '趋势基础',
    },
    outline,
  )
  assert.equal(result.content.skeleton.nodes.length, 3)
  assert.ok(result.content.skeleton.nodes.some((node) => node.title === '趋势基础'))
  assert.equal(result.content.sectionPlan.lessons[0]?.sectionId, outline.nodes[2]!.id)

  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'merge_chapters', nodeIds: [outline.nodes[0]!.id, outline.nodes[2]!.id], title: 'x' },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('applyTweak：粒度微调改子节数，别名撞名报 409', () => {
  const content = baseContent()
  const outline = parseOutline(OUTLINE_TEXT)
  const result = applyTweak(
    content,
    { op: 'set_granularity', lessonId: 'l1', subLessonCount: 5 },
    outline,
  )
  assert.equal(result.content.sectionPlan.lessons[0]?.subLessonCount, 5)

  assert.throws(
    () => applyTweak(content, { op: 'add_alias', conceptId: 'cpt_1', alias: '级别' }, outline),
    (err: unknown) => err instanceof HttpError && err.status === 409,
  )
  const aliased = applyTweak(
    content,
    { op: 'add_alias', conceptId: 'cpt_1', alias: '价格趋势' },
    outline,
  )
  assert.deepEqual(aliased.content.conceptMap.concepts[0]?.aliases, ['价格趋势'])
  // 术语表与概念图谱同源：别名同步进术语表
  assert.deepEqual(aliased.content.glossary.items[0]?.aliases, ['价格趋势'])
})

/** 两篇两章四课时——移动/重排用例的骨架。 */
const MOVE_TEXT = [
  '第一篇 总论',
  '第一章 甲',
  '1. 甲一',
  '2. 甲二',
  '第二章 乙',
  '1. 乙一',
].join('\n')

function moveFixture(): { content: TweakedContent; outline: ReturnType<typeof parseOutline> } {
  const outline = parseOutline(MOVE_TEXT)
  const { skeleton } = buildSkeleton(
    outline,
    outline.nodes.map((node) => ({ nodeId: node.id, matchScore: 0.9 })),
  )
  const content: TweakedContent = {
    skeleton,
    conceptMap: { concepts: [], edges: [] },
    glossary: { items: [] },
    sectionPlan: {
      lessons: outline.nodes
        .filter((node) => node.level === 3)
        .map((node, index) => ({
          id: `l${index + 1}`,
          sectionId: node.id,
          title: node.title,
          subLessonCount: 2,
          estimatedMinutes: 9,
          parallelSlot: 1,
          sourceUnitIds: [],
        })),
    },
    violations: [],
  }
  return { content, outline }
}

test('applyTweak：移动节点换父章，目录树与骨架同步', () => {
  const { content, outline } = moveFixture()
  const part = outline.nodes[0]!
  const chapterA = outline.nodes[1]!
  const lessonA2 = outline.nodes[3]!
  const chapterB = outline.nodes[4]!
  const result = applyTweak(
    content,
    { op: 'move_node', nodeId: lessonA2.id, newParentId: chapterB.id, position: 0 },
    outline,
  )
  const moved = result.outline.nodes.find((node) => node.id === lessonA2.id)
  assert.equal(moved?.parentId, chapterB.id)
  // 骨架跟着换父
  const skeletonNode = result.content.skeleton.nodes.find((node) => node.id === lessonA2.id)
  assert.equal(skeletonNode?.parentId, chapterB.id)
  // 原父节点不再挂着它
  assert.ok(
    !result.outline.nodes.some(
      (node) => node.id === lessonA2.id && node.parentId === chapterA.id,
    ),
  )
  // 目录树仍是「先父后子」的文档顺序：甲一留在甲下，甲二挪到乙下
  assert.deepEqual(
    result.outline.nodes.map((node) => node.id),
    [part.id, chapterA.id, outline.nodes[2]!.id, chapterB.id, lessonA2.id, outline.nodes[5]!.id],
  )
})

test('applyTweak：移动节点到同级指定位置', () => {
  const { content, outline } = moveFixture()
  const chapterA = outline.nodes[1]!
  const lessonA1 = outline.nodes[2]!
  const lessonA2 = outline.nodes[3]!
  const result = applyTweak(
    content,
    { op: 'move_node', nodeId: lessonA2.id, newParentId: chapterA.id, position: 0 },
    outline,
  )
  const chapterChildren = result.outline.nodes
    .filter((node) => node.parentId === chapterA.id)
    .map((node) => node.id)
  assert.deepEqual(chapterChildren, [lessonA2.id, lessonA1.id])
})

test('applyTweak：拒绝把章节移进自己的下级', () => {
  const { content, outline } = moveFixture()
  const chapterA = outline.nodes[1]!
  const lessonA1 = outline.nodes[2]!
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'move_node', nodeId: chapterA.id, newParentId: lessonA1.id, position: 0 },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('applyTweak：拒绝跨层级移动（课时只挂章、章只挂篇、篇只挂顶级）', () => {
  const { content, outline } = moveFixture()
  const part = outline.nodes[0]!
  const chapterA = outline.nodes[1]!
  const lessonA1 = outline.nodes[2]!
  // 课时挂到篇下
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'move_node', nodeId: lessonA1.id, newParentId: part.id, position: 0 },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
  // 章挂到章下
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'move_node', nodeId: chapterA.id, newParentId: outline.nodes[4]!.id, position: 0 },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
  // 篇挂到章下
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'move_node', nodeId: part.id, newParentId: chapterA.id, position: 0 },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})

test('applyTweak：拒绝把父节点搬空（移走最后一个子节点）', () => {
  const { content, outline } = moveFixture()
  const chapterB = outline.nodes[4]!
  const lessonB1 = outline.nodes[5]!
  const chapterA = outline.nodes[1]!
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'move_node', nodeId: lessonB1.id, newParentId: chapterA.id, position: 0 },
        outline,
      ),
    (err: unknown) =>
      err instanceof HttpError && err.status === 400 && err.message.includes('移走会留下空节点'),
  )
})

test('applyTweak：课时重排必须给出全排列，否则 400', () => {
  const { content, outline } = moveFixture()
  const ids = content.sectionPlan.lessons.map((lesson) => lesson.id)
  const reordered = applyTweak(
    content,
    { op: 'reorder_lessons', lessonIds: [...ids].reverse() },
    outline,
  )
  assert.deepEqual(
    reordered.content.sectionPlan.lessons.map((lesson) => lesson.id),
    [...ids].reverse(),
  )

  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'reorder_lessons', lessonIds: [ids[0]!] },
        outline,
      ),
    (err: unknown) =>
      err instanceof HttpError && err.status === 400 && err.message.includes('全排列'),
  )
  assert.throws(
    () =>
      applyTweak(
        content,
        { op: 'reorder_lessons', lessonIds: [...ids.slice(1), 'l_unknown'] },
        outline,
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400,
  )
})
