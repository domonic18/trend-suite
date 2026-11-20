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

/** 课程摘要：工作台的课程卡与侧栏要显示「这门课到哪一步了」——光有标题和状态不够。 */
export const courseSummaryView = courseView.extend({
  /** 素材总数 / 已就绪数（转写与理解都跑完才算就绪）。 */
  assetCount: z.number().int().nonnegative(),
  readyAssetCount: z.number().int().nonnegative(),
  /** 当前方案状态：没有方案 / 草案 / 已批准。 */
  planStatus: z.enum(['none', 'draft', 'approved']),
  planVersion: z.number().int().nonnegative().nullable(),
  /** 目录里的章数与课时数（取自当前方案的骨架）。 */
  chapterCount: z.number().int().nonnegative(),
  lessonCount: z.number().int().nonnegative(),
  /** 生产节数 / 已完成节数。 */
  sectionCount: z.number().int().nonnegative(),
  doneSectionCount: z.number().int().nonnegative(),
})

export const createCourseResponse = z.object({ course: courseView })

export const courseListResponse = z.object({ items: z.array(courseSummaryView) })

export type CreateCourseRequest = z.infer<typeof createCourseRequest>
export type CourseView = z.infer<typeof courseView>
export type CourseSummaryView = z.infer<typeof courseSummaryView>
export type CreateCourseResponse = z.infer<typeof createCourseResponse>
export type CourseListResponse = z.infer<typeof courseListResponse>
