import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessFor, canEnterArea } from './access'

/**
 * 控制台分区：登录页公开，运营控制台与教师工作台各按角色口径。
 * 判错了会出现「教师看见运营菜单」或「运营被挡在门外」。
 */

test('accessFor：登录页公开，/ops 走运营，其余走工作台', () => {
  assert.equal(accessFor('/login'), 'public')
  assert.equal(accessFor('/ops'), 'ops')
  assert.equal(accessFor('/ops'), 'ops')
  assert.equal(accessFor('/workbench'), 'workbench')
  assert.equal(accessFor('/workbench/courses/crs_1/plan'), 'workbench')
})

test('canEnterArea：工作台与运营台对 producer 及以上开放（运营台 producer 只读，写权限在 service 层）', () => {
  assert.equal(canEnterArea('public', 'student'), true)
  assert.equal(canEnterArea('workbench', 'producer'), true)
  assert.equal(canEnterArea('workbench', 'operator'), true)
  assert.equal(canEnterArea('workbench', 'admin'), true)
  assert.equal(canEnterArea('workbench', 'student'), false)

  assert.equal(canEnterArea('ops', 'producer'), true)
  assert.equal(canEnterArea('ops', 'operator'), true)
  assert.equal(canEnterArea('ops', 'admin'), true)
  assert.equal(canEnterArea('ops', 'student'), false)
})
