import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { createAccount } from '@/server/accounts/service'
import { HttpError } from '@/server/lib/http'
import { createCourse, deleteCourse, listCoursesFor, listCourseSummariesFor } from './service'

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

before(async () => {
  if (url) await resetTestDatabase()
})

test('新建课程恒为草稿，并出现在教师自己的课程列表里', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi',
    password: 'correct-horse',
    role: 'producer',
  })

  const course = await createCourse(teacher.id, '总论卷')
  assert.equal(course.status, 'draft')
  assert.equal(course.title, '总论卷')

  const mine = await listCoursesFor({
    id: teacher.id,
    username: teacher.username,
    role: teacher.role,
    displayName: teacher.displayName,
  })
  assert.equal(mine.length, 1)
  assert.equal(mine[0]?.id, course.id)
})

test('教师只看得到自己的课，运营看得到全部', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-scoped',
    password: 'correct-horse',
    role: 'producer',
  })
  const other = await createAccount({
    username: 'laoshi-scoped-2',
    password: 'correct-horse',
    role: 'producer',
  })
  const ops = await createAccount({
    username: 'yunying-scoped',
    password: 'correct-horse',
    role: 'operator',
  })

  await createCourse(teacher.id, '范围课')
  await createCourse(other.id, '范围课二')

  const teacherView = await listCoursesFor({
    id: teacher.id,
    username: teacher.username,
    role: teacher.role,
    displayName: teacher.displayName,
  })
  assert.equal(teacherView.length, 1)
  assert.equal(teacherView[0]?.title, '范围课')

  const opsView = await listCoursesFor({
    id: ops.id,
    username: ops.username,
    role: ops.role,
    displayName: ops.displayName,
  })
  const opsTitles = opsView.map((c) => c.title)
  assert.ok(opsTitles.includes('范围课'))
  assert.ok(opsTitles.includes('范围课二'))
})

test('建课带目录先验：原文与目录树同源落库；认不出的行不拦建课', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-outline',
    password: 'correct-horse',
    role: 'producer',
  })

  const course = await createCourse(teacher.id, '有目录的课', {
    outlineText: '第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义\n2. 趋势与波动',
  })

  const [row] = await query<{ outline_text: string | null; outline: unknown }>(
    'SELECT outline_text, outline FROM courses WHERE id = $1',
    [course.id],
  )
  assert.ok(row)
  assert.equal(row.outline_text, '第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义\n2. 趋势与波动')
  const outline = row.outline as { nodes?: { level: number; title: string }[] }
  assert.equal(outline.nodes?.length, 4)
  assert.equal(outline.nodes?.[0]?.level, 1)
  assert.equal(outline.nodes?.[3]?.level, 3)

  // 格式认不出的行：原文照存，目录树不落——教师可在方案页改格式重提。
  const bad = await createCourse(teacher.id, '坏格式目录的课', { outlineText: '这一行认不出层级' })
  const [badRow] = await query<{ outline_text: string | null; outline: unknown }>(
    'SELECT outline_text, outline FROM courses WHERE id = $1',
    [bad.id],
  )
  assert.equal(badRow?.outline_text, '这一行认不出层级')
  assert.equal(badRow?.outline, null)
})

test('课程摘要：素材数、方案状态、章·课时数与生产进度一次取齐', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-summary',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '摘要课')

  await query(
    `INSERT INTO media_assets (id, course_id, original_name, status)
     VALUES ($1, $2, '一.mp4', 'ready'), ($3, $4, '二.mp4', 'uploaded')`,
    [`ma_sum_1_${course.id}`, course.id, `ma_sum_2_${course.id}`, course.id],
  )
  await query(
    `INSERT INTO course_plans (id, course_id, version, status, skeleton, concept_map, glossary, section_plan, created_by)
     VALUES ($1, $2, 1, 'draft', $3::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $4)`,
    [
      `pl_sum_${course.id}`,
      course.id,
      JSON.stringify({
        nodes: [
          { id: 'n1', level: 1 },
          { id: 'n2', level: 2 },
          { id: 'n3', level: 3 },
          { id: 'n4', level: 2 },
          { id: 'n5', level: 3 },
        ],
      }),
      teacher.id,
    ],
  )
  await query(
    `INSERT INTO sections (id, course_id, section_id, title, status)
     VALUES ($1, $2, 's1', '第一节', 'complete'), ($3, $4, 's2', '第二节', 'pending')`,
    [`se_sum_1_${course.id}`, course.id, `se_sum_2_${course.id}`, course.id],
  )

  const [summary] = await listCourseSummariesFor({
    id: teacher.id,
    username: teacher.username,
    role: teacher.role,
    displayName: teacher.displayName,
  })

  assert.ok(summary)
  assert.equal(summary.assetCount, 2)
  assert.equal(summary.readyAssetCount, 1)
  assert.equal(summary.planStatus, 'draft')
  assert.equal(summary.planVersion, 1)
  assert.equal(summary.chapterCount, 2)
  assert.equal(summary.lessonCount, 2)
  assert.equal(summary.sectionCount, 2)
  assert.equal(summary.doneSectionCount, 1)
})

test('建课可带目标与素材：素材可跨课选用，归属课程不变', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-asset',
    password: 'correct-horse',
    role: 'producer',
  })
  const stranger = await createAccount({
    username: 'laoshi-asset-stranger',
    password: 'correct-horse',
    role: 'producer',
  })

  // 素材归属老课。
  const owner = await createCourse(teacher.id, '素材归属课')
  const assetId = `ma_pick_${owner.id}`
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, status)
     VALUES ($1, $2, '素材.mp4', 'ready')`,
    [assetId, owner.id],
  )
  const strangerCourse = await createCourse(stranger.id, '别人的课')
  const strangerAsset = `ma_pick_stranger_${strangerCourse.id}`
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, status)
     VALUES ($1, $2, '别人的素材.mp4', 'ready')`,
    [strangerAsset, strangerCourse.id],
  )

  // 别人的素材不能选进自己的课。
  await assert.rejects(
    () => createCourse(teacher.id, '越权课', { assetIds: [strangerAsset] }),
    (err: unknown) => err instanceof Error && err.message.includes('不属于你'),
  )

  const course = await createCourse(teacher.id, '选材新课', {
    goal: '让学员看懂趋势',
    assetIds: [assetId],
  })
  const [row] = await query<{
    goal: string | null
    plan_asset_ids: string[] | null
    plan_mode: string | null
    outline_text: string | null
  }>(
    'SELECT goal, plan_asset_ids, plan_mode, outline_text FROM courses WHERE id = $1',
    [course.id],
  )
  assert.equal(row?.goal, '让学员看懂趋势')
  assert.deepEqual(row?.plan_asset_ids, [assetId])
  // 没有目录先验 = 让 Agent 代拟（smart）；有目录先验 = 沿用人工目录。
  assert.equal(row?.plan_mode, 'smart')

  const withOutline = await createCourse(teacher.id, '有目录的新课', {
    outlineText: '第一篇 总论',
    assetIds: [assetId],
  })
  const [outlineRow] = await query<{ plan_mode: string | null; outline_text: string | null }>(
    'SELECT plan_mode, outline_text FROM courses WHERE id = $1',
    [withOutline.id],
  )
  assert.equal(outlineRow?.plan_mode, 'follow_manual')
  assert.equal(outlineRow?.outline_text, '第一篇 总论')
})

test('删除课程幂等：二次删除不抛错（不存在视为已删除）', { skip }, async () => {
  const teacher = await createAccount({
    username: 'laoshi-del-idem',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(teacher.id, '待删课')
  await deleteCourse(teacher, course.id)
  await assert.doesNotReject(() => deleteCourse(teacher, course.id))
})

test('删除课程：归属校验仍在——别人的课 403；已删的课任何人删都幂等', { skip }, async () => {
  const owner = await createAccount({
    username: 'laoshi-del-owner',
    password: 'correct-horse',
    role: 'producer',
  })
  const other = await createAccount({
    username: 'laoshi-del-other',
    password: 'correct-horse',
    role: 'producer',
  })
  const course = await createCourse(owner.id, '有主课')

  await assert.rejects(
    () => deleteCourse(other, course.id),
    (err: unknown) => err instanceof HttpError && err.status === 403,
  )
  await deleteCourse(owner, course.id)
  await assert.doesNotReject(() => deleteCourse(other, course.id))
})
