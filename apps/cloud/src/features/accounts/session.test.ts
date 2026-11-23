import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTokenStore } from './session'

/**
 * 令牌存储是会话状态的唯一事实源：写入即发布变更，订阅者自动跟进。
 * SessionProvider 靠这个约定保证「anonymous ⇔ 无令牌」不变量，
 * 登录/登出/401 清除三类令牌变化都必须传播到订阅者。
 */

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

test('令牌读写与清除：get 未存为 null，set/clear 落到存储', () => {
  const store = createTokenStore(memoryStorage())
  assert.equal(store.get(), null)
  store.set('token-a')
  assert.equal(store.get(), 'token-a')
  store.clear()
  assert.equal(store.get(), null)
})

test('set 与 clear 都发布变更；退订后不再收到', () => {
  const store = createTokenStore(memoryStorage())
  const events: string[] = []
  const unsubscribe = store.subscribe(() => events.push(store.get() ?? 'null'))

  store.set('token-a')
  store.clear()
  assert.deepEqual(events, ['token-a', 'null'], '写入与清除各通知一次，事件带最新值')

  unsubscribe()
  store.set('token-b')
  assert.deepEqual(events, ['token-a', 'null'], '退订后不再收到通知')
})

test('多订阅者都收到变更；同一函数重复订阅只记一次', () => {
  const store = createTokenStore(memoryStorage())
  let a = 0
  let b = 0
  const countA = () => {
    a += 1
  }
  const unsubA = store.subscribe(countA)
  store.subscribe(() => {
    b += 1
  })

  store.set('token-a')
  assert.equal(a, 1)
  assert.equal(b, 1)

  store.subscribe(countA)
  store.clear()
  assert.equal(a, 2, 'Set 去重：重复订阅同一函数只触发一次')
  assert.equal(b, 2)

  unsubA()
  store.set('token-b')
  assert.equal(a, 2, '退订一次即彻底移除（Set 去重，不存在残留订阅）')
  assert.equal(b, 3)
})
