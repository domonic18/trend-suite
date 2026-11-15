'use client'

import { courseListResponse, createCourseResponse, type CourseView } from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

export async function listCourses(): Promise<CourseView[]> {
  const data = await apiRequest<unknown>('/v1/admin/content/courses')
  return courseListResponse.parse(data).items
}

export async function createCourse(title: string): Promise<CourseView> {
  const data = await apiRequest<unknown>('/v1/admin/content/courses', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  return createCourseResponse.parse(data).course
}
