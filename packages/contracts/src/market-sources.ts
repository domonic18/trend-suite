import { z } from 'zod'
import { idShape } from './ids'

/**
 * 行情源配置（arch/06 §5）：K 线数据来源由运营台维护，不再代码 hardcode。
 * 至多一个默认启用源；运行时取默认源 base_url，查库失败回退环境变量。
 */

export const marketQuoteSourceView = z.object({
  id: z.string().regex(idShape.marketSource),
  name: z.string(),
  baseUrl: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  note: z.string().nullable(),
  lastTestedAt: z.string().nullable(),
  lastTestResult: z.string().nullable(),
  /** 最近一次连通性测试的耗时（毫秒）；未测过为 null。 */
  lastTestLatencyMs: z.number().int().nullable(),
  /** 最近一次连通性测试的失败原因（截断 ≤500 字）；成功时清空为 null。 */
  lastTestError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createMarketSourceRequest = z.object({
  name: z.string().min(1, '名称必填').max(64, '名称最长 64 个字符'),
  baseUrl: z.string().url('Base URL 不合法').max(255, 'Base URL 最长 255 个字符'),
  note: z.string().max(255, '备注最长 255 个字符').optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

export const updateMarketSourceRequest = z.object({
  name: z.string().min(1, '名称必填').max(64, '名称最长 64 个字符').optional(),
  baseUrl: z.string().url('Base URL 不合法').max(255, 'Base URL 最长 255 个字符').optional(),
  note: z.string().max(255, '备注最长 255 个字符').nullable().optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

export const marketQuoteSourceListResponse = z.object({ items: z.array(marketQuoteSourceView) })

export const marketSourceTestResultView = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int(),
  /** 探测拉到的样本 K 线根数（一只示例股票的日线）。 */
  sampleBars: z.number().int(),
  testedAt: z.string(),
})

export type MarketQuoteSourceView = z.infer<typeof marketQuoteSourceView>
export type CreateMarketSourceRequest = z.infer<typeof createMarketSourceRequest>
export type UpdateMarketSourceRequest = z.infer<typeof updateMarketSourceRequest>
export type MarketQuoteSourceListResponse = z.infer<typeof marketQuoteSourceListResponse>
export type MarketSourceTestResultView = z.infer<typeof marketSourceTestResultView>
