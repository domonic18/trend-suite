import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SourceUnitRow } from '@/server/pipeline/processing/repo'
import {
  MAX_LESSONS,
  MIN_MINUTES_PER_LESSON,
  buildPlanningUnits,
  deriveLessonBudget,
  deriveTotalMinutes,
  estimateMinutesOf,
  formatPlanningUnits,
  spanMinutesOf,
  subLessonCountOf,
  teachingPointsOf,
  totalPoints,
} from './planning'

/**
 * 智能规划的输入与规模推导（迭代 8）：纯函数用例，不需要库。
 * 口径一旦定死就别改——目录规模、覆盖率与提示词都依赖它。
 */

function unitRow(input: {
  id: string
  assetId: string
  startMs: number
  endMs: number
  points?: string[]
}): SourceUnitRow {
  return {
    id: input.id,
    course_id: 'crs_1',
    asset_id: input.assetId,
    start_ms: input.startMs,
    end_ms: input.endMs,
    text: '',
    visual_desc: null,
    concept_refs: [],
    extra: input.points ? { teachingPoints: input.points } : {},
    chunk_index: 0,
    model_id: null,
  }
}

test('teachingPointsOf：只认非空字符串数组，其余一律当没有要点', () => {
  assert.deepEqual(teachingPointsOf({ teachingPoints: ['a', '  ', 'b'] }), ['a', 'b'])
  assert.deepEqual(teachingPointsOf({ teachingPoints: 'a' }), [])
  assert.deepEqual(teachingPointsOf({}), [])
  assert.deepEqual(teachingPointsOf(null), [])
  assert.deepEqual(teachingPointsOf('x'), [])
})

test('buildPlanningUnits：没有理解结果的单元不进规划输入，出处带素材名与时间码', () => {
  const units = buildPlanningUnits(
    [
      unitRow({ id: 'su_1', assetId: 'ast_1', startMs: 0, endMs: 300_000, points: ['要点甲'] }),
      unitRow({ id: 'su_2', assetId: 'ast_1', startMs: 300_000, endMs: 600_000 }),
      unitRow({ id: 'su_3', assetId: 'ast_2', startMs: 0, endMs: 120_000, points: ['要点乙'] }),
    ],
    new Map([
      ['ast_1', '第一讲.mp4'],
      ['ast_2', '第二讲.mp4'],
    ]),
  )
  assert.equal(units.length, 2)
  assert.equal(units[0]?.assetName, '第一讲.mp4')
  assert.deepEqual(units[0]?.points, ['要点甲'])
  assert.equal(totalPoints(units), 2)
})

test('deriveLessonBudget：规模由素材推导——时长与粒度两条约束取交集', () => {
  // 120 分钟、60 条要点：时长上限 15 课时，粒度上限 60 课时 → 取 15
  const budget = deriveLessonBudget({ pointCount: 60, totalMinutes: 120 })
  assert.equal(budget.max, Math.floor(120 / MIN_MINUTES_PER_LESSON))
  assert.ok(budget.min <= budget.target && budget.target <= budget.max)
})

test('deriveLessonBudget：素材很短时上限很小，不铺开到 40 课时', () => {
  const budget = deriveLessonBudget({ pointCount: 6, totalMinutes: 12 })
  assert.equal(budget.max, 1)
  assert.equal(budget.min, 1)
  assert.equal(budget.target, 1)
})

test('deriveLessonBudget：要点少但素材长时上限按要点数收敛', () => {
  // 300 分钟但只有 6 条要点 → 最多 6 课时（一课时至少一个知识点）
  const budget = deriveLessonBudget({ pointCount: 6, totalMinutes: 300 })
  assert.equal(budget.max, 6)
  assert.ok(budget.max < 40)
  assert.ok(budget.min <= budget.target && budget.target <= budget.max)
})

test('deriveLessonBudget：成本兜底上限 40 课时', () => {
  const budget = deriveLessonBudget({ pointCount: 10_000, totalMinutes: 10_000 })
  assert.equal(budget.max, MAX_LESSONS)
  assert.equal(budget.min, Math.floor(MAX_LESSONS / 2))
})

test('deriveLessonBudget：素材为空也给得出至少 1 课时', () => {
  const budget = deriveLessonBudget({ pointCount: 0, totalMinutes: 0 })
  assert.deepEqual(budget, { min: 1, max: 1, target: 1 })
})

test('deriveTotalMinutes：时长取证据跨度与素材标称时长的较大者', () => {
  const units = buildPlanningUnits(
    [
      unitRow({ id: 'su_1', assetId: 'ast_1', startMs: 0, endMs: 600_000, points: ['甲'] }),
      unitRow({ id: 'su_2', assetId: 'ast_1', startMs: 600_000, endMs: 900_000, points: ['乙'] }),
      unitRow({ id: 'su_3', assetId: 'ast_2', startMs: 0, endMs: 60_000, points: ['丙'] }),
    ],
    new Map([
      ['ast_1', '第一讲.mp4'],
      ['ast_2', '第二讲.mp4'],
    ]),
  )
  // ast_1 跨度 15 分钟；ast_2 跨度 1 分钟但标称 30 分钟 → 取 30
  assert.equal(
    deriveTotalMinutes(
      units,
      new Map([
        ['ast_1', null],
        ['ast_2', 1800],
      ]),
    ),
    45,
  )
  // 标称时长缺失时只按证据跨度算
  assert.equal(deriveTotalMinutes(units, new Map()), 16)
})

test('estimateMinutesOf：估时以绑定单元的时长为准，且落在 1～240 分钟区间', () => {
  const units = buildPlanningUnits(
    [
      unitRow({ id: 'su_1', assetId: 'ast_1', startMs: 0, endMs: 600_000, points: ['甲'] }),
      unitRow({ id: 'su_2', assetId: 'ast_1', startMs: 600_000, endMs: 900_000, points: ['乙'] }),
    ],
    new Map([['ast_1', '第一讲.mp4']]),
  )
  assert.equal(estimateMinutesOf(units, ['su_1', 'su_2']), 15)
  assert.equal(estimateMinutesOf(units, ['su_1']), 10)
  // 没有绑定单元时给下限 1 分钟（不再有 5 分钟的地板——短课时也是真的）
  assert.equal(estimateMinutesOf(units, []), 1)
})

test('spanMinutesOf：跨度取绑定单元的最晚结束减最早开始', () => {
  const units = buildPlanningUnits(
    [
      unitRow({ id: 'su_1', assetId: 'ast_1', startMs: 0, endMs: 600_000, points: ['甲'] }),
      unitRow({ id: 'su_2', assetId: 'ast_1', startMs: 600_000, endMs: 900_000, points: ['乙'] }),
    ],
    new Map([['ast_1', '第一讲.mp4']]),
  )
  assert.equal(spanMinutesOf(units, ['su_1', 'su_2']), 15)
  assert.equal(spanMinutesOf(units, ['su_2']), 5)
  assert.equal(spanMinutesOf(units, []), 0)
})

test('subLessonCountOf：粒度由要点数推导，一要点一子节', () => {
  assert.equal(subLessonCountOf([]), 1)
  assert.equal(subLessonCountOf(['甲']), 1)
  assert.equal(subLessonCountOf(['甲', '乙', '丙']), 3)
  assert.equal(subLessonCountOf(new Array(30).fill('甲')), 20)
})

test('formatPlanningUnits：按素材分组，每条要点带证据单元 id 与时间码', () => {
  const units = buildPlanningUnits(
    [
      unitRow({ id: 'su_1', assetId: 'ast_1', startMs: 0, endMs: 65_000, points: ['要点甲', '要点乙'] }),
      unitRow({ id: 'su_2', assetId: 'ast_2', startMs: 0, endMs: 30_000, points: ['要点丙'] }),
    ],
    new Map([
      ['ast_1', '第一讲.mp4'],
      ['ast_2', '第二讲.mp4'],
    ]),
  )
  const text = formatPlanningUnits(units)
  assert.ok(text.includes('【第一讲.mp4 ast_1】'))
  assert.ok(text.includes('【第二讲.mp4 ast_2】'))
  assert.ok(text.includes('- su_1 [00:00–01:05] 要点甲；要点乙'))
  assert.ok(text.includes('- su_2 [00:00–00:30] 要点丙'))
})
