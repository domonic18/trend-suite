import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDsl } from './validator'
import { parseDsl } from './dsl-parser'
import { bignumView, cardsView, cmpView, timelineView } from '@/features/content/ui/blockView'

/**
 * JSON 容器块的 body 形状在服务端复检与客户端渲染之间必须同源
 * （arch/06 §2.1）：两边各写一套字段名时，服务端判过的正文在预览里会
 * 渲染成「未支持的容器块」。本用例把 arch/06 的形状钉死在两处。
 */

const DEPS = {
  figureIds: new Set<string>(),
  units: new Map(),
  stockCodes: new Set<string>(),
  terms: [] as string[],
}

function issuesOf(body: string) {
  return validateDsl(parseDsl(body), DEPS)
}

test('cards：arch/06 形状服务端判过、渲染器也读得出', () => {
  const body = ':::cards\n{"items":[{"num":"01","title":"先定位置","desc":"看相对关键点的高低"}]}\n:::'
  assert.deepEqual(issuesOf(body), [])
  assert.deepEqual(cardsView(JSON.stringify({ items: [{ num: '01', title: '先定位置', desc: '看相对关键点的高低' }] })), [
    { title: '01 · 先定位置', desc: '看相对关键点的高低' },
  ])
})

test('bignum：arch/06 形状服务端判过、渲染器也读得出', () => {
  const body = ':::bignum\n{"items":[{"label":"回踩确认","value":"3 根","note":"连续 K 线不破前低"}]}\n:::'
  assert.deepEqual(issuesOf(body), [])
  assert.deepEqual(
    bignumView(JSON.stringify({ items: [{ label: '回踩确认', value: '3 根', note: '连续 K 线不破前低' }] })),
    [{ value: '3 根', caption: '回踩确认 · 连续 K 线不破前低' }],
  )
})

test('cmp：arch/06 形状（left/right 的 head+items）服务端判过、渲染器也读得出', () => {
  const body =
    ':::cmp mode="card"\n{"title":"两种读盘方式","left":{"head":"主观","items":["看盘感"]},"right":{"head":"可验证","items":["逐项检查"]}}\n:::'
  assert.deepEqual(issuesOf(body), [])
  const view = cmpView(
    JSON.stringify({ title: '两种读盘方式', left: { head: '主观', items: ['看盘感'] }, right: { head: '可验证', items: ['逐项检查'] } }),
  )
  assert.equal(view?.left.head, '主观')
  assert.deepEqual(view?.right.items, ['逐项检查'])
})

test('timeline：arch/06 形状服务端判过、渲染器也读得出', () => {
  const body =
    ':::timeline\n{"events":[{"date":"2024-03-01","title":"起涨"},{"date":"2024-04-18","title":"回踩确认"},{"date":"2024-05-30","title":"趋势段完成"}]}\n:::'
  assert.deepEqual(issuesOf(body), [])
  const view = timelineView(
    JSON.stringify({
      events: [
        { date: '2024-03-01', title: '起涨' },
        { date: '2024-04-18', title: '回踩确认' },
        { date: '2024-05-30', title: '趋势段完成' },
      ],
    }),
  )
  assert.equal(view?.[0]?.date, '2024-03-01')
  assert.equal(view?.[1]?.title, '回踩确认')
})

test('形状不合约定时：服务端报 body_schema_failed、渲染器返回 null（不渲出半截内容）', () => {
  const body = ':::cards\n{"items":[{"t":"先定位置","d":"看相对关键点的高低"}]}\n:::'
  const issues = issuesOf(body)
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.code, 'body_schema_failed')
  assert.equal(cardsView(JSON.stringify({ items: [{ t: '先定位置', d: '看相对关键点的高低' }] })), null)
})
