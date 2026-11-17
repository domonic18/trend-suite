import { test } from 'node:test'
import assert from 'node:assert/strict'
import { minimaxAsrUrl, minimaxImageUrl } from './endpoints'
import { testImageModel } from './test'

/**
 * 端点拼接与图像通道连通性测试：
 * baseUrl 根地址/带 /v1 两种写法都要拼对（不产生 /v1/v1 双前缀）；
 * MiniMax 的错误体有两形状（HTTP 4xx 与 HTTP 200 + base_resp），都要判失败。
 */

test('minimaxAsrUrl：根地址补 /v1，带 /v1 不重复补', () => {
  assert.equal(minimaxAsrUrl('https://api.minimax.cn'), 'https://api.minimax.cn/v1/speech_to_text')
  assert.equal(
    minimaxAsrUrl('https://api.minimax.cn/v1'),
    'https://api.minimax.cn/v1/speech_to_text',
  )
  // 结尾斜杠与末段版本号（v4）都按已带版本处理
  assert.equal(
    minimaxAsrUrl('https://api.minimax.cn/v1/'),
    'https://api.minimax.cn/v1/speech_to_text',
  )
  assert.equal(
    minimaxAsrUrl('https://open.bigmodel.cn/api/paas/v4'),
    'https://open.bigmodel.cn/api/paas/v4/speech_to_text',
  )
})

test('minimaxImageUrl：新端点与老端点各自成对', () => {
  assert.equal(
    minimaxImageUrl('https://api.minimax.cn', 'modern'),
    'https://api.minimax.cn/v1/images/generations',
  )
  assert.equal(
    minimaxImageUrl('https://api.minimax.cn/v1', 'modern'),
    'https://api.minimax.cn/v1/images/generations',
  )
  assert.equal(
    minimaxImageUrl('https://api.minimax.cn/v1', 'legacy'),
    'https://api.minimax.cn/v1/image_generation',
  )
})

test('testImageModel：新端点 404 时回落到老端点', async () => {
  const calls: string[] = []
  const outcome = await testImageModel({
    baseUrl: 'https://api.minimax.cn/v1',
    apiKey: 'sk-test',
    model: 'image-01',
    fetchImpl: (async (url: string) => {
      calls.push(String(url))
      if (String(url).endsWith('/images/generations')) {
        return new Response('404 page not found', { status: 404 })
      }
      return new Response(
        JSON.stringify({ data: { image_urls: ['https://x/y.png'] }, base_resp: { status_code: 0 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as typeof fetch,
  })
  assert.equal(outcome.ok, true)
  assert.equal(calls.length, 2)
  assert.equal(calls[0], 'https://api.minimax.cn/v1/images/generations')
  assert.equal(calls[1], 'https://api.minimax.cn/v1/image_generation')
})

test('testImageModel：HTTP 200 但 base_resp 报错判失败（MiniMax 鉴权失败形状）', async () => {
  const outcome = await testImageModel({
    baseUrl: 'https://api.minimax.cn/v1',
    apiKey: 'sk-test',
    model: 'MiniMax-H3-Image',
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          base_resp: { status_code: 1004, status_msg: 'login fail: api key invalid' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch,
  })
  assert.equal(outcome.ok, false)
  assert.ok(outcome.message.includes('login fail'))
})

test('testImageModel：上游 4xx 报出状态与正文', async () => {
  const outcome = await testImageModel({
    baseUrl: 'https://api.minimax.cn/v1',
    apiKey: 'sk-test',
    model: 'MiniMax-H3-Image',
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'bad_request_error', message: "invalid params, unknown model 'x' (2013)" },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch,
  })
  assert.equal(outcome.ok, false)
  assert.ok(outcome.message.includes('400'))
  assert.ok(outcome.message.includes('unknown model'))
})
