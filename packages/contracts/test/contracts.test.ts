import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  healthResponse,
  loginRequest,
  createAccountRequest,
  createCourseRequest,
  errorBody,
  isWorkbenchRole,
} from '../src/index.js'

test('healthResponse 契约', () => {
  assert.equal(healthResponse.parse({ ok: true }).ok, true)
})

test('loginRequest 只认非空用户名与口令', () => {
  assert.equal(loginRequest.safeParse({ username: 'laoshi', password: 'x' }).success, true)
  assert.equal(loginRequest.safeParse({ username: '', password: 'x' }).success, false)
  assert.equal(loginRequest.safeParse({ username: 'laoshi', password: '' }).success, false)
})

test('createAccountRequest 拒弱口令与非法用户名', () => {
  const ok = { username: 'laoshi', password: 'correct-horse', role: 'producer' as const }
  assert.equal(createAccountRequest.safeParse(ok).success, true)
  assert.equal(createAccountRequest.safeParse({ ...ok, password: 'short' }).success, false)
  assert.equal(createAccountRequest.safeParse({ ...ok, username: 'A b' }).success, false)
  assert.equal(createAccountRequest.safeParse({ ...ok, role: 'root' }).success, false)
})

test('createCourseRequest 拒空标题', () => {
  assert.equal(createCourseRequest.safeParse({ title: '总论卷' }).success, true)
  assert.equal(createCourseRequest.safeParse({ title: '' }).success, false)
})

test('错误体只带首个问题（firstIssue），不带错误数组', () => {
  const parsed = errorBody.parse({
    error: { code: 'invalid_request', message: '参数不合法', firstIssue: { path: 'title', message: '课程名称必填' } },
  })
  assert.equal(parsed.error.firstIssue?.path, 'title')
  assert.equal('errors' in parsed.error, false)
})

test('学员角色不可进入生产工作台', () => {
  assert.equal(isWorkbenchRole('student'), false)
  assert.equal(isWorkbenchRole('producer'), true)
  assert.equal(isWorkbenchRole('operator'), true)
  assert.equal(isWorkbenchRole('admin'), true)
})
