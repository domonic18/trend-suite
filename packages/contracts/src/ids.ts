/**
 * 跨端 ID 形状统一（arch/01 §2.4）：前缀 + 固定长度 hex。
 * 契约只管「形状」，生成规则在服务端（apps/cloud/src/server/lib/ids.ts）。
 */
export const idPrefix = {
  user: 'usr',
  session: 'ses',
  course: 'crs',
  mediaAsset: 'ast',
  model: 'mod',
  pipelineJob: 'job',
  transcriptSegment: 'seg',
  mediaFrame: 'frm',
  plan: 'pln',
  concept: 'cpt',
  aiRun: 'air',
  aiUsage: 'aue',
  productionTask: 'ptk',
  section: 'sec',
  caseStock: 'cst',
} as const

export const idShape = {
  user: /^usr_[0-9a-f]{16}$/,
  session: /^ses_[0-9a-f]{32}$/,
  course: /^crs_[0-9a-f]{16}$/,
  mediaAsset: /^ast_[0-9a-f]{16}$/,
  model: /^mod_[0-9a-f]{16}$/,
  pipelineJob: /^job_[0-9a-f]{16}$/,
  transcriptSegment: /^seg_[0-9a-f]{16}$/,
  mediaFrame: /^frm_[0-9a-f]{16}$/,
  plan: /^pln_[0-9a-f]{16}$/,
  concept: /^cpt_[0-9a-f]{16}$/,
  aiRun: /^air_[0-9a-f]{16}$/,
  aiUsage: /^aue_[0-9a-f]{16}$/,
  productionTask: /^ptk_[0-9a-f]{16}$/,
  section: /^sec_[0-9a-f]{16}$/,
  caseStock: /^cst_[0-9a-f]{16}$/,
} as const

export type IdKind = keyof typeof idShape
