import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlanSectionNodeView } from '@trend-suite/contracts'
import { buildOutlineTree, countOutlineLevels, siblingInfoOf } from './outlineTree'

/**
 * 目录分组与计数（呈现层）：骨架是扁平数组，靠 level 归拢成篇/章/课时，
 * 否则卡片会把三级目录拍平成一列——「章节混乱」的另一半原因。
 */

function node(
  id: string,
  level: 1 | 2 | 3,
  parentId: string | null,
  title = id,
): PlanSectionNodeView {
  return { id, level, parentId, title, matchScore: 1, matchStatus: 'ok', sourceUnitIds: [] }
}

const NODES: PlanSectionNodeView[] = [
  node('n1', 1, null, '第一篇 总论'),
  node('n2', 2, 'n1', '第一章 什么是趋势'),
  node('n3', 3, 'n2', '1. 趋势的定义'),
  node('n4', 2, 'n1', '第二章 趋势的度量'),
  node('n5', 3, 'n4', '1. 均线'),
  node('n6', 1, null, '第二篇 实操'),
  node('n7', 2, 'n6', '第三章 看盘演练'),
  node('n8', 3, 'n7', '1. 分时图'),
]

test('countOutlineLevels：篇/章/课时分列计数', () => {
  assert.deepEqual(countOutlineLevels(NODES), { parts: 2, chapters: 3, lessons: 3 })
})

test('buildOutlineTree：按篇归拢章与课时', () => {
  const groups = buildOutlineTree(NODES)

  assert.equal(groups.length, 2)
  assert.equal(groups[0]?.part?.id, 'n1')
  assert.equal(groups[0]?.chapters.length, 2)
  assert.equal(groups[0]?.chapters[0]?.lessons[0]?.id, 'n3')
  assert.equal(groups[1]?.part?.id, 'n6')
  assert.equal(groups[1]?.chapters[0]?.lessons[0]?.id, 'n8')
})

test('buildOutlineTree：没有篇的章与没有章的课时都有归属', () => {
  const groups = buildOutlineTree([
    node('n1', 2, null, '第一章 孤儿章'),
    node('n2', 3, 'n1', '1. 孤儿课时'),
    node('n3', 3, null, '1. 无章课时'),
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0]?.part, null)
  assert.equal(groups[0]?.chapters.length, 1)
  assert.equal(groups[0]?.chapters[0]?.lessons[0]?.id, 'n2')
  assert.deepEqual(
    groups[0]?.loose.map((item) => item.id),
    ['n3'],
  )
})

test('siblingInfoOf：给出同级位置与总数，上移下移据此算', () => {
  assert.deepEqual(siblingInfoOf(NODES, 'n3'), { parentId: 'n2', index: 0, count: 1 })
  assert.deepEqual(siblingInfoOf(NODES, 'n5'), { parentId: 'n4', index: 0, count: 1 })
  assert.deepEqual(siblingInfoOf(NODES, 'n2'), { parentId: 'n1', index: 0, count: 2 })
  assert.deepEqual(siblingInfoOf(NODES, 'n4'), { parentId: 'n1', index: 1, count: 2 })
  // 顶级节点（篇）互为同级
  assert.deepEqual(siblingInfoOf(NODES, 'n6'), { parentId: null, index: 1, count: 2 })
  // 节点不存在返回 null
  assert.equal(siblingInfoOf(NODES, 'nope'), null)
})
