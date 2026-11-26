import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  courseScaleOf,
  courseStatusTagOf,
  nextActionOf,
  phaseOfPath,
  progressOf,
  type CoursePhaseInput,
} from './coursePhase'

/**
 * 课程阶段口径：教师在任何一个界面上看到的「到哪一步了 / 下一步干什么」
 * 都必须出自这里，否则侧栏与课程卡会各说各话。
 */

const EMPTY: CoursePhaseInput = {
  assetCount: 0,
  readyAssetCount: 0,
  planStatus: 'none',
  planVersion: null,
  chapterCount: 0,
  lessonCount: 0,
  sectionCount: 0,
  doneSectionCount: 0,
}

function input(patch: Partial<CoursePhaseInput>): CoursePhaseInput {
  return { ...EMPTY, ...patch }
}

test('空课程：素材待办，下一步是去素材库上传', () => {
  const next = nextActionOf(EMPTY)
  assert.equal(next.phase, 'material')
  assert.equal(next.label, '去素材库上传')
  assert.equal(courseStatusTagOf(EMPTY).text, '待上传素材')
})

test('素材处理中：方案与生产仍待办', () => {
  const next = nextActionOf(input({ assetCount: 2, readyAssetCount: 1 }))
  assert.equal(next.phase, 'material')
  assert.equal(next.label, '等待素材就绪')
  assert.equal(courseStatusTagOf(input({ assetCount: 2, readyAssetCount: 1 })).text, '素材处理中')
})

test('素材齐备但无方案：下一步是起草方案', () => {
  const state = input({ assetCount: 2, readyAssetCount: 2 })
  const next = nextActionOf(state)
  assert.equal(next.phase, 'plan')
  assert.equal(next.label, '起草课程方案')
  assert.equal(courseStatusTagOf(state).text, '待起草方案')
})

test('方案草案待审：下一步是批准方案', () => {
  const state = input({ assetCount: 1, readyAssetCount: 1, planStatus: 'draft', planVersion: 2 })
  const next = nextActionOf(state)
  assert.equal(next.phase, 'plan')
  assert.equal(next.label, '审阅并批准方案')
  assert.match(next.hint, /v2/)
  assert.equal(courseStatusTagOf(state).text, '方案待审阅')
})

test('方案已批准但还没起跑：下一步开始生产', () => {
  const state = input({
    assetCount: 1,
    readyAssetCount: 1,
    planStatus: 'approved',
    planVersion: 1,
  })
  const next = nextActionOf(state)
  assert.equal(next.phase, 'production')
  assert.equal(next.label, '开始九步生产')
  assert.equal(courseStatusTagOf(state).text, '待生产')
})

test('生产中：进度按已完成节数走', () => {
  const state = input({
    assetCount: 1,
    readyAssetCount: 1,
    planStatus: 'approved',
    planVersion: 1,
    sectionCount: 4,
    doneSectionCount: 1,
  })
  const next = nextActionOf(state)
  assert.equal(next.phase, 'production')
  assert.equal(next.label, '查看生产进度')
  assert.match(next.hint, /1\/4/)
  assert.equal(courseStatusTagOf(state).text, '生产中')
})

test('全部完成：下一步交给运营', () => {
  const state = input({
    assetCount: 1,
    readyAssetCount: 1,
    planStatus: 'approved',
    planVersion: 1,
    sectionCount: 4,
    doneSectionCount: 4,
  })
  const next = nextActionOf(state)
  assert.equal(next.phase, 'readiness')
  assert.equal(courseStatusTagOf(state).text, '生产完成')
})

test('深链反推阶段：课程根路径不标阶段（立即重定向），其余落对应阶段', () => {
  assert.equal(phaseOfPath('/workbench/courses/crs_1'), null)
  assert.equal(phaseOfPath('/workbench/courses/crs_1/plan'), 'plan')
  assert.equal(phaseOfPath('/workbench/courses/crs_1/production'), 'production')
  assert.equal(phaseOfPath('/workbench/courses/crs_1/production/sections/s1/preview'), 'production')
})

test('进度：三段各占三分之一', () => {
  assert.equal(progressOf(EMPTY), 0)
  assert.equal(progressOf(input({ assetCount: 2, readyAssetCount: 2 })), 1 / 3)
  assert.equal(
    progressOf(input({ assetCount: 2, readyAssetCount: 2, planStatus: 'approved' })),
    2 / 3,
  )
  assert.equal(
    progressOf(
      input({
        assetCount: 2,
        readyAssetCount: 2,
        planStatus: 'approved',
        sectionCount: 4,
        doneSectionCount: 4,
      }),
    ),
    1,
  )
})

test('规模说明：章·课时数与素材数', () => {
  assert.equal(courseScaleOf(EMPTY), '还没有素材')
  assert.equal(
    courseScaleOf(input({ assetCount: 3, chapterCount: 2, lessonCount: 6 })),
    '2 章 · 6 课时 · 3 个素材',
  )
})
