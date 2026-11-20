import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callImageEndpoint } from './image'

/**
 * 文生图通道的响应形状（arch/07 §9 图像生成端点行）：
 *
 * 端到端实测暴露——H3-Image 新端点（/v1/images/generations）回的是
 * `data[0].url`（图片地址），不是 `b64_json`；旧解析只认 base64，于是每一次
 * 文生图都判成 image_empty，装饰图全被剔除（预发 8 次调用全废）。
 * 这里锁住两种回法都要能用。
 */

const CHANNEL = { baseUrl: 'https://api.example.com', model: 'test-image' }
const BODY = JSON.stringify({ model: 'test-image', prompt: '一个红色圆点', n: 1 })

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('上游回 base64：直接用', async () => {
  const result = await callImageEndpoint({
    channel: CHANNEL,
    headers: {},
    body: BODY,
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: 'QUJD' }] }),
  })
  assert.equal(result.base64, 'QUJD')
  assert.equal(result.endpoint, 'modern')
})

test('上游回图片地址：下载后转 base64（H3-Image 新端点的回法）', async () => {
  const calls: string[] = []
  const result = await callImageEndpoint({
    channel: CHANNEL,
    headers: {},
    body: BODY,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('/images/generations')) {
        return jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] })
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    },
  })
  assert.equal(result.base64, Buffer.from([1, 2, 3]).toString('base64'))
  assert.equal(result.endpoint, 'modern')
  assert.ok(calls.includes('https://cdn.example.com/a.png'), '图片地址要被下载')
})

test('上游既没给 base64 也没给地址：判 image_empty', async () => {
  await assert.rejects(
    callImageEndpoint({
      channel: CHANNEL,
      headers: {},
      body: BODY,
      fetchImpl: async () => jsonResponse({ data: [] }),
    }),
    /图像上游没有返回图片数据/,
  )
})

test('老端点回 data.image_urls：也要能用（老版 image-01 的回法）', async () => {
  const result = await callImageEndpoint({
    channel: CHANNEL,
    headers: {},
    body: BODY,
    fetchImpl: async (url) => {
      if (url.includes('/images/generations')) {
        return new Response('404 page not found', { status: 404 })
      }
      if (url.includes('/image_generation')) {
        return jsonResponse({ data: { image_urls: ['https://cdn.example.com/legacy.png'] } })
      }
      return new Response(new Uint8Array([7, 8, 9]), { status: 200 })
    },
  })
  assert.equal(result.base64, Buffer.from([7, 8, 9]).toString('base64'))
  assert.equal(result.endpoint, 'legacy')
})

test('上游回非 https 的图片地址：拒（地址来自上游，不接受明文 http）', async () => {
  await assert.rejects(
    callImageEndpoint({
      channel: CHANNEL,
      headers: {},
      body: BODY,
      fetchImpl: async () => jsonResponse({ data: [{ url: 'http://cdn.example.com/a.png' }] }),
    }),
    /不是 https/,
  )
})

test('上游用 base_resp 报错：判拒绝（HTTP 200 不等于成功）', async () => {
  await assert.rejects(
    callImageEndpoint({
      channel: CHANNEL,
      headers: {},
      body: BODY,
      fetchImpl: async () => jsonResponse({ base_resp: { status_code: 2013, status_msg: '不支持的模型' } }),
    }),
    /图像上游拒绝/,
  )
})
