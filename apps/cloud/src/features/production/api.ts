'use client'

import {
  productionBoardResponse,
  resyncQuotesResponse,
  retryProductionSectionResponse,
  sectionQuotesResponse,
  type ProductionBoardView,
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
