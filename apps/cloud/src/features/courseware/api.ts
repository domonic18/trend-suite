'use client'

import {
  hlsPlaybackResponse,
  sectionContentResponse,
  sectionQuotesResponse,
  type HlsPlayback,
  type SectionContentView,
  type SectionQuotesView,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

/**
 * 课件内容读取（courseware 域的浏览器脸）：节教材内容 / 节行情 / 素材 HLS
 * 播放签名——都是「把已产出的课件读出来渲染」，与制作流程（production 的
 * 看板/重试/同步）分开。此前放在 production/api，导致课件渲染族反向
 * 依赖制作域（content ↔ production 循环依赖的来源之一）。
 */

/** 节行情视图（案例股清单 + bars + 常驻声明）。 */
export async function getSectionQuotes(courseId: string, sectionId: string): Promise<SectionQuotesView> {
  const data = await apiRequest<unknown>(
    `/v1/admin/content/courses/${courseId}/production/sections/${sectionId}/quotes`,
  )
  return sectionQuotesResponse.parse(data).quotes
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
