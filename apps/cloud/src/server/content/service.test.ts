import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { createAccount } from '@/server/accounts/service'
import { createCourse, listCoursesFor } from './service'

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
