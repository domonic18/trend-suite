import type { ModelProtocol } from '@trend-suite/contracts'

/**
 * 厂商预置（arch/07 §9 迭代 2 验收反馈）：base_url 为各家公开文档端点值。
 * 选预置项自动填协议与 Base URL，均可手改；「其他」走自由输入。
 * provider 落库存显示名（label），与历史手填数据形态一致。
 */
export type ProviderPreset = {
  value: string
  label: string
  protocol: ModelProtocol
  baseUrl: string
  modelExamples: string[]
}

export const OTHER_PROVIDER = '__other__'

export const MODEL_PROVIDERS: readonly ProviderPreset[] = [
  {
    value: 'minimax',
    label: 'MiniMax',
    protocol: 'minimax',
    baseUrl: 'https://api.minimax.chat/v1',
    modelExamples: ['MiniMax-M2', 'abab6.5s-chat', 'speech-02-hd'],
  },
  {
    value: 'zhipu',
    label: '智谱',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelExamples: ['glm-4-plus', 'glm-4-flash', 'glm-4v-flash', 'embedding-3'],
  },
  {
    value: 'moonshot',
    label: 'Moonshot Kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelExamples: ['moonshot-v1-128k', 'kimi-latest'],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    modelExamples: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    value: 'qwen',
    label: '阿里通义',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelExamples: ['qwen-max', 'qwen-vl-max', 'text-embedding-v3', 'wanx2.1-t2i-turbo'],
  },
  {
    value: 'volcengine',
    label: '字节火山',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelExamples: ['doubao-seed-1-6', 'doubao-embedding'],
  },
  {
    value: 'siliconflow',
    label: 'SiliconFlow',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelExamples: ['Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct', 'BAAI/bge-m3'],
  },
  {
    value: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    modelExamples: ['gpt-4o', 'gpt-image-1', 'text-embedding-3-small', 'whisper-1'],
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    modelExamples: ['claude-sonnet-4-6'],
  },
]

export function findProviderPreset(provider: string): ProviderPreset | undefined {
  return MODEL_PROVIDERS.find((p) => p.value === provider || p.label === provider)
}
