import { z } from 'zod'
import { courseStatus } from './enums.js'
import { idShape } from './ids.js'

export const createCourseRequest = z.object({
  title: z.string().min(1, '课程名称必填').max(120, '课程名称最长 120 个字符'),
})

export const courseView = z.object({
  id: z.string().regex(idShape.course),
  title: z.string(),
  status: courseStatus,
  ownerId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const createCourseResponse = z.object({ course: courseView })

export const courseListResponse = z.object({ items: z.array(courseView) })

export type CreateCourseRequest = z.infer<typeof createCourseRequest>
export type CourseView = z.infer<typeof courseView>
export type CreateCourseResponse = z.infer<typeof createCourseResponse>
export type CourseListResponse = z.infer<typeof courseListResponse>
