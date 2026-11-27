import { z } from 'zod'
import { idShape } from './ids'

/**
 * 模型配置（arch/07 §9）：条目统一维护，密钥 AES-GCM 加密存储，
 * 明文不进浏览器、不进日志、不进响应。
 */

/** 用途：一条条目可同时服务多个用途（如 llm+vlm 同一模型）；决定槽位可选范围与默认条目相交清除。 */
export const modelPurposes = ['llm', 'vlm', 'asr', 'embedding', 'image'] as const
export const modelPurpose = z.enum(modelPurposes)

export const modelStatuses = ['active', 'cooling', 'disabled'] as const
export const modelStatus = z.enum(modelStatuses)

/**
 * 调用协议（arch/07 §9.1）：内容 LLM 双协议（openai 兼容 / anthropic）；
 * ASR 独立走 minimax 专有协议。
 */
export const modelProtocols = ['openai', 'anthropic', 'minimax'] as const
export const modelProtocol = z.enum(modelProtocols)

export const modelEntryView = z.object({
  id: z.string().regex(idShape.model),
  name: z.string(),
  purposes: z.array(modelPurpose).min(1),
  provider: z.string(),
  protocol: modelProtocol,
  model: z.string(),
  baseUrl: z.string().nullable(),
  /** 密钥掩码：前 4 + * + 后 4；未配置时为 null。 */
  apiKeyMasked: z.string().nullable(),
  status: modelStatus,
  isDefault: z.boolean(),
  cooldownUntil: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestResult: z.string().nullable(),
  /** 最近一次连通性测试的耗时（毫秒）；未测过为 null。 */
  lastTestLatencyMs: z.number().int().nullable(),
  /** 最近一次连通性测试的失败原因（截断 ≤500 字）；成功时清空为 null。 */
  lastTestError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createModelEntryRequest = z.object({
  name: z.string().min(1, '名称必填').max(64, '名称最长 64 个字符'),
  purposes: z.array(modelPurpose).min(1, '至少选择一个用途'),
  provider: z.string().min(1, '供应商必填').max(64, '供应商最长 64 个字符'),
  protocol: modelProtocol,
  model: z.string().min(1, '模型名必填').max(128, '模型名最长 128 个字符'),
  baseUrl: z.string().url('Base URL 不合法').max(255, 'Base URL 最长 255 个字符').optional(),
  apiKey: z.string().min(1, '密钥必填').max(512, '密钥最长 512 个字符').optional(),
  isDefault: z.boolean().optional(),
})

export const updateModelEntryRequest = z.object({
  name: z.string().min(1, '名称必填').max(64, '名称最长 64 个字符').optional(),
  purposes: z.array(modelPurpose).min(1, '至少选择一个用途').optional(),
  provider: z.string().min(1, '供应商必填').max(64, '供应商最长 64 个字符').optional(),
  protocol: modelProtocol.optional(),
  model: z.string().min(1, '模型名必填').max(128, '模型名最长 128 个字符').optional(),
  baseUrl: z.string().url('Base URL 不合法').max(255, 'Base URL 最长 255 个字符').optional(),
  /** 空串表示保留原密钥（不是清空）——arch/07 §9.1 的密钥更新语义。 */
  apiKey: z.string().max(512, '密钥最长 512 个字符').optional(),
  isDefault: z.boolean().optional(),
  status: modelStatus.optional(),
})

export const modelEntryListResponse = z.object({ items: z.array(modelEntryView) })

/** 任务槽位：主模型必填、备用可选（arch/07 §9）。 */
export const taskBindingView = z.object({
  task: z.string(),
  taskLabel: z.string(),
  purpose: modelPurpose,
  primaryModelId: z.string().nullable(),
  primaryModelName: z.string().nullable(),
  backupModelId: z.string().nullable(),
  backupModelName: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const updateTaskBindingRequest = z.object({
  task: z.string().min(1, '任务键必填').max(64, '任务键最长 64 个字符'),
  primaryModelId: z.string().regex(idShape.model, '主模型 ID 不合法'),
  backupModelId: z.string().regex(idShape.model, '备用模型 ID 不合法').nullable(),
})

export const taskBindingListResponse = z.object({ items: z.array(taskBindingView) })

/**
 * ASR 渠道（运营台「ASR 渠道」页）：素材入库即转写用的那一条配置。
 * 取默认的 asr 用途条目；协议、模型、Base URL、密钥状态一眼可见。
 */
export const asrChannelView = z.object({
  modelId: z.string().nullable(),
  provider: z.string(),
  protocol: modelProtocol,
  model: z.string(),
  baseUrl: z.string(),
  apiKeyMasked: z.string().nullable(),
  status: modelStatus,
  /** 单条音频时长上限（秒）：超过即被上游拒。 */
  maxAudioSeconds: z.number(),
  /** 上游是否支持热词注入：MiniMax 专有转写接口当前不支持。 */
  hotwordSupported: z.boolean(),
  hotwordCount: z.number(),
  /** 最近一次连通性测试：状态 / 耗时 / 失败原因（与条目同源）。 */
  lastTestedAt: z.string().nullable(),
  lastTestResult: z.string().nullable(),
  lastTestLatencyMs: z.number().int().nullable(),
  lastTestError: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export const asrChannelResponse = z.object({ channel: asrChannelView })

/** 连通性测试结果：与正式调用走同一协议分支（arch/07 §9.1）。 */
export const modelTestResultView = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number(),
  testedAt: z.string(),
})

export type ModelPurpose = z.infer<typeof modelPurpose>
export type ModelStatus = z.infer<typeof modelStatus>
export type ModelProtocol = z.infer<typeof modelProtocol>
export type ModelEntryView = z.infer<typeof modelEntryView>
export type CreateModelEntryRequest = z.infer<typeof createModelEntryRequest>
export type UpdateModelEntryRequest = z.infer<typeof updateModelEntryRequest>
export type ModelEntryListResponse = z.infer<typeof modelEntryListResponse>
export type TaskBindingView = z.infer<typeof taskBindingView>
export type UpdateTaskBindingRequest = z.infer<typeof updateTaskBindingRequest>
export type TaskBindingListResponse = z.infer<typeof taskBindingListResponse>
export type AsrChannelView = z.infer<typeof asrChannelView>
export type AsrChannelResponse = z.infer<typeof asrChannelResponse>
export type ModelTestResultView = z.infer<typeof modelTestResultView>
