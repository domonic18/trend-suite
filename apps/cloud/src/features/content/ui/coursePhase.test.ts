import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coursePhases,
  courseScaleOf,
  courseStatusTagOf,
  nextActionOf,
  phaseOfPath,
  phasePathOf,
  progressOf,
  type CoursePhaseInput,
} from './coursePhase'

/**
 * 课程阶段口径：教师在任何一个界面上看到的「到哪一步了 / 下一步干什么」
 * 都必须出自这里，否则侧栏、阶段轨、课程卡会各说各话。
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

test('空课程：素材待办，下一步是上传视频', () => {
  const phases = coursePhases(EMPTY)

  assert.equal(phases[0]?.state, 'todo')
  assert.equal(phases[1]?.state, 'todo')
  assert.equal(phases[2]?.state, 'todo')
  assert.equal(phases[3]?.state, 'soon')

  const next = nextActionOf(EMPTY)
  assert.equal(next.phase, 'material')
  assert.equal(next.label, '上传课程视频')
})

test('素材处理中：素材进行中，方案与生产仍待办', () => {
  const phases = coursePhases(input({ assetCount: 2, readyAssetCount: 1 }))

  assert.equal(phases[0]?.state, 'active')
  assert.equal(phases[1]?.state, 'todo')
  assert.equal(nextActionOf(input({ assetCount: 2, readyAssetCount: 1 })).label, '等待素材就绪')
})

test('素材齐备但无方案：方案变成进行中', () => {
  const phases = coursePhases(input({ assetCount: 2, readyAssetCount: 2 }))

  assert.equal(phases[0]?.state, 'done')
  assert.equal(phases[1]?.state, 'active')
  assert.equal(nextActionOf(input({ assetCount: 2, readyAssetCount: 2 })).label, '起草课程方案')
})

test('方案草案待审：下一步是批准方案', () => {
  const state = input({ assetCount: 1, readyAssetCount: 1, planStatus: 'draft', planVersion: 2 })

  const phases = coursePhases(state)
  assert.equal(phases[1]?.state, 'active')
  assert.match(phases[1]?.hint ?? '', /v2/)
  assert.equal(nextActionOf(state).label, '审阅并批准方案')
})

test('方案已批准但还没起跑：生产进行中，下一步开始生产', () => {
  const state = input({
    assetCount: 1,
    readyAssetCount: 1,
    planStatus: 'approved',
    planVersion: 1,
  })

  const phases = coursePhases(state)
  assert.equal(phases[1]?.state, 'done')
  assert.equal(phases[2]?.state, 'active')
  assert.equal(nextActionOf(state).label, '开始九步生产')
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

  assert.match(coursePhases(state)[2]?.hint ?? '', /1\/4/)
  assert.equal(nextActionOf(state).label, '查看生产进度')
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

  assert.equal(coursePhases(state)[2]?.state, 'done')
  assert.equal(nextActionOf(state).phase, 'readiness')
})

test('阶段路由：素材是首页，方案与生产下挂，就绪度未开放', () => {
  assert.equal(phasePathOf('crs_1', 'material'), '/workbench/courses/crs_1')
  assert.equal(phasePathOf('crs_1', 'plan'), '/workbench/courses/crs_1/plan')
  assert.equal(phasePathOf('crs_1', 'production'), '/workbench/courses/crs_1/production')
  assert.equal(phasePathOf('crs_1', 'readiness'), null)
})

test('深链反推阶段：老 URL 直接落到对应阶段', () => {
  assert.equal(phaseOfPath('/workbench/courses/crs_1'), 'material')
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

test('状态标：从卡住的地方读', () => {
  assert.equal(courseStatusTagOf(EMPTY).text, '待上传素材')
  assert.equal(courseStatusTagOf(input({ assetCount: 1, readyAssetCount: 0 })).text, '素材处理中')
  assert.equal(
    courseStatusTagOf(input({ assetCount: 1, readyAssetCount: 1 })).text,
    '待起草方案',
  )
  assert.equal(
    courseStatusTagOf(input({ assetCount: 1, readyAssetCount: 1, planStatus: 'draft' })).text,
    '方案待审阅',
  )
  assert.equal(
    courseStatusTagOf(
      input({ assetCount: 1, readyAssetCount: 1, planStatus: 'approved', sectionCount: 2 }),
    ).text,
    '生产中',
  )
})

test('规模说明：章·课时数与素材数', () => {
  assert.equal(courseScaleOf(EMPTY), '还没有素材与目录')
  assert.equal(
    courseScaleOf(input({ assetCount: 3, chapterCount: 2, lessonCount: 6 })),
    '2 章 · 6 课时 · 3 个素材',
  )
})
