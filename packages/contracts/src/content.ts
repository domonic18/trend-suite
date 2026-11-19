import { z } from 'zod'
import { idShape } from './ids.js'
import { caseStockView } from './market.js'
import { figureView } from './figures.js'

/**
 * 节教材内容视图（迭代 6）：正文 DSL 原文 + 三路图示 + 被引用的 source units
 * 内联展开——管理台预览单次取全，锚点回溯不出二次请求。
 */

export const sourceUnitView = z.object({
  id: z.string().regex(idShape.sourceUnit),
  assetId: z.string().regex(idShape.mediaAsset),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string(),
  visualDesc: z.string().nullable(),
  chartType: z.string().nullable(),
  teachingPoints: z.array(z.string()),
  frameIds: z.array(z.string()),
  /** 素材已产出 HLS 才可播（管理台预览片段卡/回溯卡用）。 */
  playable: z.boolean(),
})
export type SourceUnitView = z.infer<typeof sourceUnitView>

export const sectionContentBodyStatus = z.enum(['none', 'draft', 'rejected'])
export type SectionContentBodyStatus = z.infer<typeof sectionContentBodyStatus>

export const sectionContentView = z.object({
  courseId: z.string().regex(idShape.course),
  /** 课程内大纲展示号（如 '1-1'）。 */
  sectionId: z.string().min(1),
  title: z.string(),
  dslVersion: z.number().int().min(1).nullable(),
  /** 正文 DSL 原文（渲染在客户端现场完成，存渲染后 HTML 反例——arch/06 §10）。 */
  body: z.string().nullable(),
  bodyStatus: sectionContentBodyStatus,
  figures: z.array(figureView),
  /** 本节正文引用到的 source units（去重，按出现顺序）。 */
  units: z.array(sourceUnitView),
  caseStocks: z.array(caseStockView),
})
export type SectionContentView = z.infer<typeof sectionContentView>

export const sectionContentResponse = z.object({ content: sectionContentView })
export type SectionContentResponse = z.infer<typeof sectionContentResponse>

/** 管理台预览播放签发（arch/06 §4 两种签发之一；学员端按节签发留迭代 9）。 */
export const hlsPlayback = z.object({
  url: z.string().min(1),
  expiresAt: z.string(),
})
export type HlsPlayback = z.infer<typeof hlsPlayback>
export const hlsPlaybackResponse = z.object({ playback: hlsPlayback })
export type HlsPlaybackResponse = z.infer<typeof hlsPlaybackResponse>
