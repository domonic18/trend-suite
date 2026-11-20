import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { createAccount } from '@/server/accounts/service'
import { createCourse, listCoursesFor, listCourseSummariesFor } from './service'

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
