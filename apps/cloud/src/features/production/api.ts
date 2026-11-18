'use client'

import {
  productionBoardResponse,
  retryProductionSectionResponse,
  type ProductionBoardView,
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
