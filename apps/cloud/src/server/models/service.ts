import 'server-only'
import {
  type AsrChannelView,
  type ModelEntryView,
  type ModelPurpose,
  type ModelProtocol,
  type ModelTestResultView,
  type TaskBindingView,
  type UpdateModelEntryRequest,
  type UpdateTaskBindingRequest,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { badRequest, forbidden, HttpError, notFound } from '@/server/lib/http'
import { KeySealUnavailableError, maskSecret, openSecret, sealSecret } from '@/server/lib/crypto'
import * as repo from './repo'
import { testAsrChannel, testChatModel, testEmbeddingModel } from './test'

/**
 * 模型配置（arch/07 §9）：运营侧维护，密钥 AES-GCM 加密存储。
 * 写权限只给 admin，operator 只读（arch/07 §9 权限行）——
 * 换掉模型密钥等于换掉计费与出流量向，这条口子不交给运营角色。
 */

export const TASK_SLOTS: ReadonlyArray<{ task: string; label: string; purpose: ModelPurpose }> = [
  { task: 'content.curriculum', label: '课程方案起草', purpose: 'llm' },
  { task: 'content.section_draft', label: '节教材起草', purpose: 'llm' },
  { task: 'vision.describe', label: '素材理解', purpose: 'vlm' },
  { task: 'student.qa', label: '学员问答', purpose: 'llm' },
]

/** ASR 单条音频时长上限：MiniMax 专有转写接口超过即 400（不截断）。 */
export const ASR_MAX_AUDIO_SECONDS = 500

const PROTOCOL_BY_PURPOSE: Record<ModelPurpose, readonly ModelProtocol[]> = {
  llm: ['openai', 'anthropic'],
  vlm: ['openai', 'anthropic'],
  asr: ['minimax', 'openai'],
  embedding: ['openai'],
  image: ['openai'],
}

function toView(row: repo.ModelRow): ModelEntryView {
  const plain = openSecret(row.api_key_enc)
  return {
    id: row.id,
    name: row.name,
    purposes: row.purposes as ModelEntryView['purposes'],
    provider: row.provider,
    protocol: row.protocol as ModelEntryView['protocol'],
    model: row.model,
    baseUrl: row.base_url,
    apiKeyMasked: plain === null ? null : maskSecret(plain),
    status: row.status as ModelEntryView['status'],
    isDefault: row.is_default,
    cooldownUntil: row.cooldown_until ? row.cooldown_until.toISOString() : null,
    lastTestedAt: row.last_tested_at ? row.last_tested_at.toISOString() : null,
    lastTestResult: row.last_test_result,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** Base URL 归一：去掉结尾斜杠与常见端点后缀（arch/07 §9.1），长后缀先试。 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  const suffixes = [
    '/chat/completions',
    '/audio/transcriptions',
    '/speech_to_text',
    '/embeddings',
    '/v1/chat/completions',
    '/v1/speech_to_text',
  ].sort((a, b) => b.length - a.length)
  for (const suffix of suffixes) {
    if (url.endsWith(suffix)) {
      url = url.slice(0, url.length - suffix.length).replace(/\/+$/, '')
      break
    }
  }
  return url
}

function assertProtocol(purposes: ModelPurpose[], protocol: ModelProtocol): void {
  // 多用途条目：协议必须在每个所选用途的允许集内（取交集判断）
  const missing = purposes.filter((p) => !PROTOCOL_BY_PURPOSE[p].includes(protocol))
  if (missing.length > 0) {
    throw badRequest(`${missing.join('/')} 用途不支持 ${protocol} 协议`)
  }
}

export async function listModelEntries(): Promise<ModelEntryView[]> {
  const rows = await repo.listModels()
  return rows.map(toView)
}

export async function createModelEntry(input: {
  name: string
  purposes: ModelPurpose[]
  provider: string
  protocol: ModelProtocol
  model: string
  baseUrl?: string | undefined
  apiKey?: string | undefined
  isDefault?: boolean | undefined
}): Promise<ModelEntryView> {
  assertProtocol(input.purposes, input.protocol)

  let apiKeyEnc: string | null = null
  if (input.apiKey) {
    try {
      apiKeyEnc = sealSecret(input.apiKey)
    } catch (err) {
      if (err instanceof KeySealUnavailableError) {
        throw new HttpError(503, 'model_not_configured', '模型密钥主密钥未配置，暂不能保存密钥')
      }
      throw err
    }
  }

  if (input.isDefault) await repo.clearDefaults(input.purposes)

  const row = await repo.insertModel({
    id: newId('model'),
    name: input.name,
    purposes: input.purposes,
    provider: input.provider,
    protocol: input.protocol,
    model: input.model,
    baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : null,
    apiKeyEnc,
    isDefault: input.isDefault ?? false,
    meta: {},
  })
  return toView(row)
}

export async function updateModelEntry(
  id: string,
  input: UpdateModelEntryRequest,
): Promise<ModelEntryView> {
  const existing = await repo.findModelById(id)
  if (!existing) throw notFound('模型条目不存在')

  const purposes = (input.purposes ?? existing.purposes) as ModelPurpose[]
  if (input.protocol) assertProtocol(purposes, input.protocol)
  else if (input.purposes) assertProtocol(purposes, existing.protocol as ModelProtocol)

  // 密钥更新语义：空串保留原密钥（arch/07 §9.1）。
  let apiKeyEnc: string | null | undefined
  if (input.apiKey !== undefined) {
    if (input.apiKey === '') {
      apiKeyEnc = undefined
    } else {
      try {
        apiKeyEnc = sealSecret(input.apiKey)
      } catch (err) {
        if (err instanceof KeySealUnavailableError) {
          throw new HttpError(503, 'model_not_configured', '模型密钥主密钥未配置，暂不能保存密钥')
        }
        throw err
      }
    }
  }

  if (input.isDefault) await repo.clearDefaults(purposes, id)

  const row = await repo.updateModel(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.purposes !== undefined ? { purposes: input.purposes } : {}),
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: normalizeBaseUrl(input.baseUrl) } : {}),
    ...(apiKeyEnc !== undefined ? { apiKeyEnc } : {}),
    ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  })
  return toView(row)
}

export async function deleteModelEntry(id: string): Promise<void> {
  const existing = await repo.findModelById(id)
  if (!existing) throw notFound('模型条目不存在')
  await repo.deleteModel(id)
}

export async function listTaskBindings(): Promise<TaskBindingView[]> {
  const [rows, models] = await Promise.all([repo.listBindings(), repo.listModels()])
  const byId = new Map(models.map((m) => [m.id, m]))
  return TASK_SLOTS.map((slot) => {
    const binding = rows.find((r) => r.task === slot.task) ?? null
    const primary = binding ? byId.get(binding.primary_model_id) : undefined
    const backup = binding?.backup_model_id ? byId.get(binding.backup_model_id) : undefined
    return {
      task: slot.task,
      taskLabel: slot.label,
      purpose: slot.purpose,
      primaryModelId: primary?.id ?? null,
      primaryModelName: primary?.name ?? null,
      backupModelId: backup?.id ?? null,
      backupModelName: backup?.name ?? null,
      updatedAt: binding ? binding.updated_at.toISOString() : null,
    }
  })
}

export async function updateTaskBinding(
  input: UpdateTaskBindingRequest,
): Promise<TaskBindingView> {
  const slot = TASK_SLOTS.find((s) => s.task === input.task)
  if (!slot) throw badRequest('未知的任务槽位')

  const primary = await repo.findModelById(input.primaryModelId)
  if (!primary) throw notFound('主模型条目不存在')
  if (!primary.purposes.includes(slot.purpose)) {
    throw badRequest(`主模型用途与槽位不符（槽位需要 ${slot.purpose}）`)
  }
  if (primary.status === 'disabled') throw badRequest('主模型已禁用，不能作为绑定')

  if (input.backupModelId) {
    if (input.backupModelId === input.primaryModelId) {
      throw badRequest('备用模型不能与主模型相同')
    }
    const backup = await repo.findModelById(input.backupModelId)
    if (!backup) throw notFound('备用模型条目不存在')
    if (!backup.purposes.includes(slot.purpose)) {
      throw badRequest(`备用模型用途与槽位不符（槽位需要 ${slot.purpose}）`)
    }
  }

  await repo.upsertBinding({
    task: input.task,
    primaryModelId: input.primaryModelId,
    backupModelId: input.backupModelId,
  })
  const items = await listTaskBindings()
  const view = items.find((i) => i.task === input.task)
  if (!view) throw new Error('任务绑定写入失败')
  return view
}

/** ASR 渠道（运营台第三页）：默认的 asr 用途条目。 */
export async function getAsrChannel(): Promise<AsrChannelView> {
  const row = await repo.findDefaultModel('asr')
  if (!row) {
    return {
      modelId: null,
      provider: '',
      protocol: 'minimax',
      model: '',
      baseUrl: '',
      apiKeyMasked: null,
      status: 'disabled',
      maxAudioSeconds: ASR_MAX_AUDIO_SECONDS,
      hotwordSupported: false,
      hotwordCount: 0,
      updatedAt: null,
    }
  }
  const plain = openSecret(row.api_key_enc)
  const meta = row.meta ?? {}
  return {
    modelId: row.id,
    provider: row.provider,
    protocol: row.protocol as AsrChannelView['protocol'],
    model: row.model,
    baseUrl: row.base_url ?? '',
    apiKeyMasked: plain === null ? null : maskSecret(plain),
    status: row.status as AsrChannelView['status'],
    maxAudioSeconds:
      typeof meta.maxAudioSeconds === 'number' ? meta.maxAudioSeconds : ASR_MAX_AUDIO_SECONDS,
    // MiniMax 专有转写接口当前没有热词参数，不假装支持。
    hotwordSupported: meta.hotwordSupported === true,
    hotwordCount: typeof meta.hotwordCount === 'number' ? meta.hotwordCount : 0,
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * 连通性测试：与正式调用走同一协议分支（arch/07 §9.1）。
 * 结果落条目，便于运营看到「上次测试什么时候、结果如何」。
 */
export async function testModelEntry(id: string): Promise<ModelTestResultView> {
  const row = await repo.findModelById(id)
  if (!row) throw notFound('模型条目不存在')
  const apiKey = openSecret(row.api_key_enc)
  if (!apiKey) throw badRequest('该条目未配置密钥，无法测试')

  const started = Date.now()
  let outcome: { ok: boolean; message: string }
  // 多用途条目按代表用途测试（专有协议优先）；其余用途共用同一 key/baseUrl。
  const purposes = row.purposes as ModelPurpose[]
  if (purposes.includes('asr')) {
    outcome = await testAsrChannel({ baseUrl: row.base_url, apiKey, model: row.model })
  } else if (purposes.includes('embedding')) {
    outcome = await testEmbeddingModel({ baseUrl: row.base_url, apiKey, model: row.model })
  } else if (purposes.includes('llm') || purposes.includes('vlm')) {
    outcome = await testChatModel({
      protocol: row.protocol,
      baseUrl: row.base_url,
      apiKey,
      model: row.model,
    })
  } else {
    throw badRequest('该用途暂不支持连通性测试')
  }

  const testedAt = new Date()
  await repo.updateModel(id, {
    lastTestedAt: testedAt,
    lastTestResult: outcome.ok ? 'ok' : 'failed',
  })
  return {
    ok: outcome.ok,
    message: outcome.message,
    latencyMs: Date.now() - started,
    testedAt: testedAt.toISOString(),
  }
}

/** 供运行时取用：ASR 渠道的明文密钥（只在 worker 进程内使用，不出服务边界）。 */
export async function resolveAsrChannel(): Promise<{
  modelId: string
  baseUrl: string
  apiKey: string
  model: string
  protocol: 'minimax' | 'openai'
}> {
  const row = await repo.findDefaultModel('asr')
  if (!row) {
    throw new HttpError(503, 'model_not_configured', '尚未配置 ASR 渠道，转写不可用')
  }
  const apiKey = openSecret(row.api_key_enc)
  if (!apiKey) {
    throw new HttpError(503, 'model_not_configured', 'ASR 渠道未配置密钥，转写不可用')
  }
  return {
    modelId: row.id,
    baseUrl: normalizeBaseUrl(row.base_url ?? ''),
    apiKey,
    model: row.model,
    protocol: row.protocol === 'openai' ? 'openai' : 'minimax',
  }
}

/** 运营只读：调用方角色判断（admin 可写）。 */
export function assertCanWriteModels(role: string): void {
  if (role !== 'admin') throw forbidden('只有管理员可以维护模型配置')
}
