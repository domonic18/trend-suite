import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testImageModel } from './test'

/**
 * 图像渠道的连通性测试（arch/07 §9.1）：测试请求真实发出，会计费。
 *
 * 关键口径：**HTTP 2xx 不等于真出图了**——预发实测上游回的是图片地址，
 * 旧测试只看状态码判「连通」，于是正式调用全被判 image_empty（装饰图全废）。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const BASE = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-image',
}

test('上游回 base64 或图片地址：判连通', async () => {
  const b64 = await testImageModel({
    ...BASE,
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: 'QUJD' }] }),
  })
  assert.equal(b64.ok, true)

  const url = await testImageModel({
    ...BASE,
    fetchImpl: async () => jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] }),
  })
  assert.equal(url.ok, true)

  // 老版 image-01 的回法：data.image_urls
  const legacy = await testImageModel({
    ...BASE,
    fetchImpl: async () => jsonResponse({ data: { image_urls: ['https://cdn.example.com/b.png'] } }),
  })
  assert.equal(legacy.ok, true)
})

test('上游 HTTP 200 但没有图片数据：判不通（别让「测试通、实际不通」）', async () => {
  const result = await testImageModel({
    ...BASE,
    fetchImpl: async () => jsonResponse({ data: [] }),
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /没有图片数据|data/)
})

test('上游用 base_resp 报错：判不通', async () => {
  const result = await testImageModel({
    ...BASE,
    fetchImpl: async () =>
      jsonResponse({ base_resp: { status_code: 2013, status_msg: '不支持的模型' } }),
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /上游拒绝/)
})
