import { z } from 'zod'
import { courseStatus } from './enums'
import { idShape } from './ids'

export const createCourseRequest = z.object({
  title: z.string().min(1, '课程名称必填').max(120, '课程名称最长 120 个字符'),
  /**
   * 目录先验（可选）：建课时粘贴的三级目录（篇 / 章 / 课时）。
   * 之后起草方案直接用它做骨架——教师原文优先，Agent 不改目录。
   */
  outlineText: z.string().max(20000, '目录最长 20000 个字符').optional(),
  /** 课程目标（可选）：建课时就给 Agent 方向，留空则到方案页再填。 */
  goal: z.string().max(2000, '课程目标最长 2000 个字符').optional(),
  /**
   * 参与本课建设的素材 id（可选）：素材库是跨课程的全局视角，一份素材可以被
   * 多门课选用。不传 = 只用本课自己的素材。
   */
  assetIds: z.array(z.string().min(1)).max(50, '单次最多选 50 份素材').optional(),
})

export const updateCourseRequest = z.object({
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
export type UpdateCourseRequest = z.infer<typeof updateCourseRequest>
export type CourseView = z.infer<typeof courseView>
export type CourseSummaryView = z.infer<typeof courseSummaryView>
export type CreateCourseResponse = z.infer<typeof createCourseResponse>
export type CourseListResponse = z.infer<typeof courseListResponse>
