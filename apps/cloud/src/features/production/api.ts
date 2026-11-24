'use client'

import {
  hlsPlaybackResponse,
  productionBoardResponse,
  resyncQuotesResponse,
  retryProductionSectionResponse,
  sectionContentResponse,
  sectionQuotesResponse,
  type HlsPlayback,
  type ProductionBoardView,
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

/** 重新同步节行情：只重置行情步（2/3）再重投，案例股不重跑。 */
export async function resyncSectionQuotes(courseId: string, sectionId: string): Promise<void> {
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
