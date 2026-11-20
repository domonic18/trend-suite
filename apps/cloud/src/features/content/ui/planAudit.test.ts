import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PlanLessonEvidenceView } from '@trend-suite/contracts'
import {
  evidenceDetailLinesOf,
  evidenceLineOf,
  evidenceSummaryOf,
  formatClock,
} from './planAudit'

/**
 * 出处摘要排版（呈现层）：教师核对「这一课出自哪几分钟、讲了哪些点」的口径。
 */

function ev(overrides: Partial<PlanLessonEvidenceView> = {}): PlanLessonEvidenceView {
  return {
    unitId: 'su_1',
    assetId: 'ast_1',
    assetName: '第一讲.mp4',
    startMs: 0,
    endMs: 600_000,
    points: [],
    ...overrides,
  }
}

test('formatClock：不足一小时是 mm:ss，超过一小时带小时位', () => {
  assert.equal(formatClock(0), '00:00')
  assert.equal(formatClock(60_000), '01:00')
  assert.equal(formatClock(600_000), '10:00')
  assert.equal(formatClock(3_600_000), '1:00:00')
  assert.equal(formatClock(3_725_000), '1:02:05')
})

test('evidenceLineOf：素材名 + 时间码 + 讲解要点', () => {
  const line = evidenceLineOf(ev({ points: ['趋势包含方向与能量', '趋势有持续性'] }))
  assert.equal(line, '第一讲.mp4 00:00–10:00 · 趋势包含方向与能量；趋势有持续性')
})

test('evidenceLineOf：要点多于三条时折叠，其余计数可见', () => {
  const line = evidenceLineOf(ev({ points: ['甲', '乙', '丙', '丁', '戊'] }))
  assert.ok(line.includes('甲；乙；丙'))
  assert.ok(line.includes('另 2 条'))
})

test('evidenceSummaryOf：同一素材的片段合成一条时间范围', () => {
  const summary = evidenceSummaryOf([
    ev({ unitId: 'su_1', startMs: 0, endMs: 600_000 }),
    ev({ unitId: 'su_2', startMs: 600_000, endMs: 1_200_000 }),
  ])
  assert.equal(summary, '第一讲.mp4 00:00–20:00')
})

test('evidenceSummaryOf：多个素材并列', () => {
  const summary = evidenceSummaryOf([
    ev({ unitId: 'su_1', assetName: '第一讲.mp4' }),
    ev({ unitId: 'su_2', assetName: '第二讲.mp4', startMs: 1_200_000, endMs: 1_500_000 }),
  ])
  assert.equal(summary, '第一讲.mp4 00:00–10:00；第二讲.mp4 20:00–25:00')
})

test('evidenceSummaryOf：没有出处时返回 null（空态由组件自己处理）', () => {
  assert.equal(evidenceSummaryOf([]), null)
})

test('evidenceDetailLinesOf：每条出处一行，带要点', () => {
  const lines = evidenceDetailLinesOf([
    ev({ unitId: 'su_1', points: ['趋势包含方向与能量'] }),
    ev({ unitId: 'su_2', assetName: '第二讲.mp4', startMs: 600_000, endMs: 900_000 }),
  ])
  assert.equal(lines.length, 2)
  assert.ok(lines[0]?.includes('第一讲.mp4 00:00–10:00'))
  assert.ok(lines[0]?.includes('趋势包含方向与能量'))
  assert.equal(lines[1], '第二讲.mp4 10:00–15:00')
})
