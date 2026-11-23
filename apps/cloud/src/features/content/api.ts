'use client'

import {
  courseListResponse,
  createCourseResponse,
  planJobResponse,
  planResponse,
  planView,
  conceptsResponse,
  type ConceptsResponse,
  type CourseSummaryView,
  type CourseView,
  type PlanJobView,
  type PlanResponse,
  type PlanView,
  type TweakPlanRequest,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

export async function listCourses(): Promise<CourseSummaryView[]> {
  const data = await apiRequest<unknown>('/v1/admin/content/courses')
  return courseListResponse.parse(data).items
}

/** 建课：可带上课程目标、人工目录先验与参与本次建设的素材（可跨课选用）。 */
export async function createCourse(input: {
  title: string
  goal?: string
  outlineText?: string
  assetIds?: string[]
}): Promise<CourseView> {
  const data = await apiRequest<unknown>('/v1/admin/content/courses', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.outlineText ? { outlineText: input.outlineText } : {}),
      ...(input.assetIds && input.assetIds.length > 0 ? { assetIds: input.assetIds } : {}),
    }),
  })
  return createCourseResponse.parse(data).course
}

// ---------------------------------------------------------------- 课程方案（迭代 3）

/** 当前方案 + 起草任务 + 已提交的目标与目录（轮询用）。 */
export async function getPlan(courseId: string): Promise<PlanResponse> {
  const data = await apiRequest<unknown>(`/v1/admin/content/courses/${courseId}/plan`)
  return planResponse.parse(data)
}

/** 提交课程目标与人工目录，触发起草入队（可指定规划模式与参与素材）。 */
export async function submitPlanInput(
  courseId: string,
  input: {
    goal: string
    outlineText: string
    mode?: 'smart' | 'follow_manual'
    assetIds?: string[] | undefined
  },
): Promise<PlanJobView> {
  const data = await apiRequest<unknown>(`/v1/admin/content/courses/${courseId}/plan-input`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return planJobResponse.parse(data).job
}

/** 结构化微调：即时生效，版本 +1（不走 LLM）。 */
export async function tweakPlan(courseId: string, op: TweakPlanRequest): Promise<PlanView> {
  const data = await apiRequest<unknown>(`/v1/admin/content/courses/${courseId}/plan/tweak`, {
    method: 'POST',
    body: JSON.stringify(op),
  })
  return planView.parse((data as { plan: unknown }).plan)
}

/** 批准后落库的概念与依赖（只读）。 */
export async function listConcepts(courseId: string): Promise<ConceptsResponse> {
  const data = await apiRequest<unknown>(`/v1/admin/content/courses/${courseId}/concepts`)
  return conceptsResponse.parse(data)
}
