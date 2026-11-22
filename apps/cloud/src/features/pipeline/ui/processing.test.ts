import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processingSteps, type MediaAssetView } from '@trend-suite/contracts'
import {
  STEP_LABELS,
  STEP_ORDER,
  READINESS_TEXT,
  planningReadyOf,
  readinessOf,
  understandingCountOf,
} from './processing'

test('步进条覆盖契约里的全部加工阶段（漏一个就渲染不出当前步）', () => {
  assert.deepEqual(STEP_ORDER, [...processingSteps])
  for (const step of processingSteps) {
    assert.ok(STEP_LABELS[step], `阶段 ${step} 缺展示名`)
  }
})

test('就绪度口径：就绪 / 失败 / 排队 / 停止 / 加工中', () => {
  const base = { jobStatus: null, status: 'ready', processStep: 'done' } as unknown as MediaAssetView
  assert.equal(readinessOf(base), 'ready')
  assert.equal(readinessOf({ ...base, jobStatus: 'failed' }), 'failed')
  assert.equal(readinessOf({ ...base, jobStatus: 'queued' }), 'queued')
  assert.equal(readinessOf({ ...base, jobStatus: 'canceled' }), 'stopped')
  assert.equal(
    readinessOf({ ...base, status: 'processing', processStep: 'transcribe' }),
    'running',
  )
})

test('每种就绪度都有中文文案', () => {
  for (const key of ['queued', 'running', 'ready', 'stopped', 'failed'] as const) {
    assert.ok(READINESS_TEXT[key].length > 0, `就绪度 ${key} 缺文案`)
  }
})

test('可规划口径：加工完成且有理解产出才算能参与规划', () => {
  const base = {
    jobStatus: null,
    status: 'ready',
    processStep: 'done',
    stages: [],
  } as unknown as MediaAssetView
  assert.equal(understandingCountOf(base), 0)
  assert.equal(planningReadyOf(base), false)

  const understood = {
    ...base,
    stages: [{ stage: 'understanding', status: 'done', count: 12, updatedAt: null, errorMessage: null }],
  } as unknown as MediaAssetView
  assert.equal(understandingCountOf(understood), 12)
  assert.equal(planningReadyOf(understood), true)

  // 只转写没理解 = 没有教学要点可比，勾了也规划不出东西。
  const transcriptOnly = {
    ...base,
    stages: [{ stage: 'transcript', status: 'done', count: 30, updatedAt: null, errorMessage: null }],
  } as unknown as MediaAssetView
  assert.equal(planningReadyOf(transcriptOnly), false)

  const running = { ...understood, status: 'processing', processStep: 'understand' } as unknown as MediaAssetView
  assert.equal(planningReadyOf(running), false)
})
