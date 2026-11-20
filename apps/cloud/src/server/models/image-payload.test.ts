import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractImagePayload } from './image-payload'

/**
 * 图像响应形状只有一份定义（arch/07 §9.1 图像生成端点行）：
 * 上游有四种回法，都要认——认漏一种就等于把「上游真出图了」判成 image_empty。
 */

test('data[0].b64_json：认作 base64', () => {
  const result = extractImagePayload({ data: [{ b64_json: 'QUJD' }] })
  assert.deepEqual(result, { kind: 'base64', value: 'QUJD' })
})

test('data[0].image_base64：认作 base64', () => {
  const result = extractImagePayload({ data: [{ image_base64: 'QUJD' }] })
  assert.deepEqual(result, { kind: 'base64', value: 'QUJD' })
})

test('data[0].url：认作地址（要下载图片本体）', () => {
  const result = extractImagePayload({ data: [{ url: 'https://cdn.example.com/a.png' }] })
  assert.deepEqual(result, { kind: 'url', value: 'https://cdn.example.com/a.png' })
})

test('data.image_urls[]：老版 image-01 的回法，认第一个地址', () => {
  const result = extractImagePayload({ data: { image_urls: ['https://cdn.example.com/b.png'] } })
  assert.deepEqual(result, { kind: 'url', value: 'https://cdn.example.com/b.png' })
})

test('data.image_url：老版单地址回法', () => {
  const result = extractImagePayload({ data: { image_url: 'https://cdn.example.com/c.png' } })
  assert.deepEqual(result, { kind: 'url', value: 'https://cdn.example.com/c.png' })
})

test('data 是对象时按对象本身解析（老端点形状）', () => {
  const result = extractImagePayload({ data: { image_urls: ['https://cdn.example.com/d.png'] } })
  assert.equal(result.kind, 'url')
})

test('没有图片数据：说清缺什么', () => {
  const none = extractImagePayload({ data: [] })
  assert.equal(none.kind, 'none')

  const noData = extractImagePayload({ base_resp: { status_code: 0 } })
  assert.equal(noData.kind, 'none')
})
