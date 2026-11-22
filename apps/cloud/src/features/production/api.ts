'use client'

import {
  hlsPlaybackResponse,
  productionBoardResponse,
  productionStopView,
  productionStreamResponse,
  resyncQuotesResponse,
  resumeProductionResponse,
  retryProductionSectionResponse,
  sectionContentResponse,
  sectionQuotesResponse,
  stopProductionResponse,
  type HlsPlayback,
  type ProductionBoardView,
  type ProductionStopView,
  type ProductionStreamResponse,
  type SectionContentView,
  type SectionQuotesView,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

/** 九步看板（节行 × 9 步格 + job 态），生产活跃时 3 秒轮询。 */
export async function getProductionBoard(courseId: string): Promise<ProductionBoardView> {
  const data = await apiRequest<unknown>(`/v1/admin/content/courses/${courseId}/production`)
  return productionBoardResponse.parse(data).board
}

/** 挂起节重试：清零 attempts 回 pending 并重投 job。 */
export async function retryProductionSection(courseId: string, sectionId: string): Promise<void> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/sections/${sectionId}/retry`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  retryProductionSectionResponse.parse(data)
}

/** 节行情视图（案例股清单 + bars + 常驻声明）。 */
export async function getSectionQuotes(courseId: string, sectionId: string): Promise<SectionQuotesView> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/sections/${sectionId}/quotes`,
  )
  return sectionQuotesResponse.parse(data).quotes
}

/** 重新同步行情：只重置步骤 2/3（步骤 1 案例股不重跑）并重投 job。 */
export async function resyncQuotes(courseId: string, sectionId: string): Promise<void> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/sections/${sectionId}/quotes/resync`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  resyncQuotesResponse.parse(data)
}

/** 节教材内容预览（正文 DSL 原文 + 三路图示 + 内联 source units）。 */
export async function getSectionContent(courseId: string, sectionId: string): Promise<SectionContentView> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/sections/${sectionId}/content`,
  )
  return sectionContentResponse.parse(data).content
}

/** 管理台预览签发素材 HLS 播放地址（短时签名）。 */
export async function getHlsPlayback(assetId: string): Promise<HlsPlayback> {
  const data = await apiRequest<unknown>(`/v1/admin/content/media-assets/${assetId}/hls`)
  return hlsPlaybackResponse.parse(data).playback
}

/**
 * 停止制作（教师端需求 T21）：步边界安全中止——
 * 当前步跑完才停，已完成的步成果保留，回灌预算不清零。
 */
export async function stopProduction(courseId: string): Promise<ProductionStopView> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/stop`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  return productionStopView.parse(stopProductionResponse.parse(data).stop)
}

/** 继续制作：从停下的地方续跑，已完成的步不重跑。 */
export async function resumeProduction(courseId: string): Promise<void> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/resume`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  resumeProductionResponse.parse(data)
}

/** Agent 事件流（增量）：带上次游标续读，不全量拉。 */
export async function getProductionStream(
  courseId: string,
  afterSeq: string | null,
): Promise<ProductionStreamResponse> {
  const query = afterSeq ? `?afterSeq=${encodeURIComponent(afterSeq)}` : ''
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/stream${query}`,
  )
  return productionStreamResponse.parse(data)
}
