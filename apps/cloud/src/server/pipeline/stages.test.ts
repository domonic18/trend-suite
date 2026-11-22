import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MediaStage } from '@trend-suite/contracts'
import { buildStageViews } from './stages'
import type { StageStateRow } from './stage-repo'

/**
 * 三段视图的拼装口径（教师端需求 T4b）：
 * 台账记过程事实（正在跑 / 失败 / 有缺口），产物条数记完成量；
 * 两者不一致时以台账为准，产物为空却记「完成」按空处理。
 */

function state(
  stage: MediaStage,
  status: string,
  errorMessage: string | null = null,
): StageStateRow {
  return {
    asset_id: 'ast_1',
    stage,
    status,
    error_message: errorMessage,
    updated_at: new Date('2026-11-22T10:00:00Z'),
  }
}

describe('buildStageViews', () => {
  it('没有台账时按产物条数推导：有条即完成，无条即空', () => {
    const views = buildStageViews({
      transcript: { count: 20, updatedAt: null },
      frames: { count: 0, updatedAt: null },
      understanding: { count: 24, updatedAt: null },
    })
    assert.equal(views.length, 3)
    assert.equal(views[0]?.stage, 'transcript')
    assert.equal(views[0]?.status, 'done')
    assert.equal(views[0]?.count, 20)
    assert.equal(views[1]?.status, 'empty')
    assert.equal(views[2]?.status, 'done')
  })

  it('台账记的过程事实优先于产物条数', () => {
    const views = buildStageViews({
      states: new Map<string, StageStateRow>([
        ['transcript', state('transcript', 'running')],
        ['understanding', state('understanding', 'failed', '上游 429')],
      ]),
      transcript: { count: 13, updatedAt: null },
      understanding: { count: 17, updatedAt: null },
    })
    assert.equal(views[0]?.status, 'running')
    assert.equal(views[2]?.status, 'failed')
    // 失败原因只在失败/有缺口时透出
    assert.equal(views[2]?.errorMessage, '上游 429')
    assert.equal(views[0]?.errorMessage, null)
  })

  it('台账记完成但产物为空 → 按空处理（不谎报已完成）', () => {
    const views = buildStageViews({
      states: new Map<string, StageStateRow>([
        ['frames', state('frames', 'done')],
      ]),
      frames: { count: 0, updatedAt: null },
    })
    assert.equal(views[1]?.status, 'empty')
  })

  it('部分完成保留失败原因，产出条数照实', () => {
    const views = buildStageViews({
      states: new Map<string, StageStateRow>([
        ['understanding', state('understanding', 'partial', '17/32 块失败')],
      ]),
      understanding: { count: 17, updatedAt: null },
    })
    assert.equal(views[2]?.status, 'partial')
    assert.equal(views[2]?.count, 17)
    assert.equal(views[2]?.errorMessage, '17/32 块失败')
  })

  it('更新时间取台账与产物中较晚的一个', () => {
    const later = new Date('2026-11-22T12:00:00Z')
    const views = buildStageViews({
      states: new Map<string, StageStateRow>([
        ['transcript', state('transcript', 'done')],
      ]),
      transcript: { count: 20, updatedAt: later },
    })
    assert.equal(views[0]?.updatedAt, later.toISOString())
  })
})
