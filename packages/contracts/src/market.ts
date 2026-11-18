import { z } from 'zod'
import { idShape } from './ids.js'

/**
 * 案例股与行情（arch/06 §5 口径）：腾讯前复权（qfq）、日线/周线原生周期
 * （不自聚合）、volume 单位手、amount 恒缺省；数值可核——bars 与源逐根对得上。
 */

/** 行情周期：原生 day / week，映射腾讯接口 period=day|week。 */
export const marketPeriod = z.enum(['1d', '1w'])
export type MarketPeriod = z.infer<typeof marketPeriod>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** 一根 K 线：日期 + 开高低收 + 成交量（手）。amount 恒缺省不建模。 */
export const klineBar = z.object({
  d: isoDate,
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().min(0),
})
export type KlineBar = z.infer<typeof klineBar>

/** 事件锚点：案例事件日期 + 说明；date 为声明原值。 */
export const caseStockEvent = z.object({
  date: isoDate,
  label: z.string().min(1).max(60),
})
export type CaseStockEvent = z.infer<typeof caseStockEvent>

export const caseStockView = z.object({
  id: z.string().regex(idShape.caseStock),
  code: z.string().regex(/^\d{6}$/),
  name: z.string().min(1),
  exchange: z.enum(['SH', 'SZ']),
  period: marketPeriod,
  windowStart: isoDate,
  windowEnd: isoDate,
  events: z.array(caseStockEvent).max(5),
  /** 云端复检自动修正等说明（如「日线深度不足，已自动改用周线」）。 */
  notes: z.array(z.string()),
})
export type CaseStockView = z.infer<typeof caseStockView>

/** 单股行情可得性：ok 全窗口有数 / partial 部分覆盖 / unavailable 源不可用。 */
export const marketStatus = z.enum(['ok', 'partial', 'unavailable'])
export type MarketStatus = z.infer<typeof marketStatus>

/** 事件锚点交易日归一：resolvedDate 为窗口内 ≤ 原值的最后交易日（无 bar 时 null）。 */
export const eventAnchorView = z.object({
  date: isoDate,
  label: z.string().min(1),
  resolvedDate: isoDate.nullable(),
})
export type EventAnchorView = z.infer<typeof eventAnchorView>

/** 单股行情视图：清单 + 读回 bars + 锚点归一，看板/学员端共用同一形状。 */
export const stockQuotesView = caseStockView.extend({
  marketStatus,
  bars: z.array(klineBar),
  eventAnchors: z.array(eventAnchorView),
  lastSyncedAt: z.string().nullable(),
})
export type StockQuotesView = z.infer<typeof stockQuotesView>

/** 复权口径常驻声明（arch/06 §5.4）：原型 student-course.html 同文案，单一事实源。 */
export const marketDeclaration =
  '周期：日线 / 周线 · 前复权（腾讯源）· 图示为录制时点前复权，与当前前复权存在除权漂移 · 不构成投资建议'

export const sectionQuotesView = z.object({
  // 展示号（课程内大纲编号，如 '1-1'），与 productionBoardView.sectionId 同口径。
  sectionId: z.string().min(1),
  stocks: z.array(stockQuotesView),
  declaration: z.literal(marketDeclaration),
})
export type SectionQuotesView = z.infer<typeof sectionQuotesView>

export const sectionQuotesResponse = z.object({ quotes: sectionQuotesView })
export type SectionQuotesResponse = z.infer<typeof sectionQuotesResponse>

export const resyncQuotesResponse = z.object({ ok: z.literal(true) })
export type ResyncQuotesResponse = z.infer<typeof resyncQuotesResponse>
