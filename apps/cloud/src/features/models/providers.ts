import type { ModelProtocol } from '@trend-suite/contracts'

/**
 * 厂商预置（arch/07 §9）：只收录国内常用厂商的**中国大陆**公开文档端点。
 * 每个协议各有一份地址——切协议必须同步换地址，拿 OpenAI 兼容地址去调
 * Anthropic 端点只会 404。地址未经实测/文档确认不得写入本表。
 * provider 落库存显示名（label），与历史手填数据形态一致。
 */
export type ProviderPreset = {
  value: string
  label: string
  /** 预置默认协议；不在用途允许集内时回落到该厂商首个可用协议 */
  protocol: ModelProtocol
  /** 各协议端点；缺项 = 该厂商不支持该协议 */
  endpoints: Partial<Record<ModelProtocol, string>>
  modelExamples: string[]
}

export const OTHER_PROVIDER = '__other__'

export const MODEL_PROVIDERS: readonly ProviderPreset[] = [
  {
    value: 'zhipu',
    label: '智谱',
    protocol: 'openai',
    endpoints: {
      openai: 'https://open.bigmodel.cn/api/paas/v4',
      anthropic: 'https://open.bigmodel.cn/api/anthropic',
    },
    modelExamples: ['glm-4-plus', 'glm-4-flash', 'glm-4v-flash', 'embedding-3'],
  },
  {
    value: 'minimax',
    label: 'MiniMax',
    // 专有协议优先（转写走 /v1/speech_to_text）；内容生成用途下不在允许集，自动回落 OpenAI 兼容。
    protocol: 'minimax',
    endpoints: {
      openai: 'https://api.minimaxi.com/v1',
      anthropic: 'https://api.minimaxi.com/anthropic',
      minimax: 'https://api.minimaxi.com',
    },
    modelExamples: ['MiniMax-M2', 'MiniMax-M2.1', 'speech-02-hd', 'MiniMax-H3-Image'],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    endpoints: {
      openai: 'https://api.deepseek.com/v1',
      anthropic: 'https://api.deepseek.com/anthropic',
    },
    modelExamples: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    value: 'moonshot',
    label: 'Moonshot Kimi',
    protocol: 'openai',
    endpoints: {
      openai: 'https://api.moonshot.cn/v1',
      anthropic: 'https://api.moonshot.cn/anthropic',
    },
    modelExamples: ['kimi-latest', 'kimi-k2-0905-preview', 'moonshot-v1-128k'],
  },
  {
    value: 'qwen',
    label: '阿里通义',
    protocol: 'openai',
    // 百炼目前没有 Anthropic 兼容端点（实测 /anthropic、/api/v2/anthropic 均 404）。
    endpoints: {
      openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
    modelExamples: ['qwen-max', 'qwen3-vl-plus', 'text-embedding-v4', 'wanx2.1-t2i-turbo'],
  },
  {
    value: 'volcengine',
    label: '字节火山',
    protocol: 'openai',
    endpoints: {
      openai: 'https://ark.cn-beijing.volces.com/api/v3',
      anthropic: 'https://ark.cn-beijing.volces.com/api/v3/anthropic',
    },
    modelExamples: ['doubao-seed-1-6', 'doubao-seed-1-6-thinking', 'doubao-embedding'],
  },
]

/** 该厂商在指定协议下的端点；不支持该协议则 null。 */
export function providerBaseUrl(preset: ProviderPreset, protocol: ModelProtocol): string | null {
  return preset.endpoints[protocol] ?? null
}

/** 该厂商支持的协议列表（顺序即回落顺序）。 */
export function providerProtocols(preset: ProviderPreset): ModelProtocol[] {
  return Object.keys(preset.endpoints) as ModelProtocol[]
}

/** 当前 baseUrl 是否仍是预置值：只有预置值才允许被协议切换覆盖，手填地址不动。 */
export function isPresetBaseUrl(url: string): boolean {
  return MODEL_PROVIDERS.some((p) => Object.values(p.endpoints).includes(url))
}

export function findProviderPreset(provider: string): ProviderPreset | undefined {
  return MODEL_PROVIDERS.find((p) => p.value === provider || p.label === provider)
}
