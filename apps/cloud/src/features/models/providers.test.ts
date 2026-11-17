import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_PROVIDERS,
  findProviderPreset,
  isPresetBaseUrl,
  providerBaseUrl,
  providerProtocols,
} from './providers'

/**
 * 厂商预置表：只留国内常用六家，地址必须是中国大陆端点；
 * 各协议各有一份地址——切协议换地址，不能拿 OpenAI 兼容地址调 Anthropic。
 */

test('厂商预置只含六家国内常用厂商', () => {
  assert.deepEqual(
    MODEL_PROVIDERS.map((p) => p.label),
    ['智谱', 'MiniMax', 'DeepSeek', 'Moonshot Kimi', '阿里通义', '字节火山'],
  )
})

test('预置端点都是中国大陆地址，不含国际版与已下架厂商', () => {
  for (const preset of MODEL_PROVIDERS) {
    for (const url of Object.values(preset.endpoints)) {
      assert.ok(url, `${preset.label} 端点不得为空`)
      assert.match(url, /^https:\/\//)
      assert.ok(!/minimax\.io|api\.openai\.com|api\.anthropic\.com|siliconflow/.test(url), url)
    }
  }
})

test('MiniMax：OpenAI 兼容与 Anthropic 端点不同，且转写走专有端点', () => {
  const minimax = findProviderPreset('minimax')
  assert.ok(minimax)
  assert.equal(providerBaseUrl(minimax, 'openai'), 'https://api.minimaxi.com/v1')
  assert.equal(providerBaseUrl(minimax, 'anthropic'), 'https://api.minimaxi.com/anthropic')
  assert.equal(providerBaseUrl(minimax, 'minimax'), 'https://api.minimaxi.com')
  assert.ok(providerProtocols(minimax).includes('minimax'))
})

test('阿里百炼没有 Anthropic 端点（实测 404），不凭空补地址', () => {
  const qwen = findProviderPreset('qwen')
  assert.ok(qwen)
  assert.equal(providerBaseUrl(qwen, 'anthropic'), null)
  assert.deepEqual(providerProtocols(qwen), ['openai'])
})

test('findProviderPreset 按 value 与 label 都能命中', () => {
  assert.equal(findProviderPreset('zhipu')?.label, '智谱')
  assert.equal(findProviderPreset('智谱')?.value, 'zhipu')
  assert.equal(findProviderPreset('SiliconFlow'), undefined)
})

test('isPresetBaseUrl 只认预置值，手填地址不覆盖', () => {
  assert.equal(isPresetBaseUrl('https://api.minimaxi.com/v1'), true)
  assert.equal(isPresetBaseUrl('https://api.minimaxi.com/anthropic'), true)
  assert.equal(isPresetBaseUrl('https://my-proxy.internal/v1'), false)
})
