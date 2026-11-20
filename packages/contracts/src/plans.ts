import { z } from 'zod'
import {
  conceptEdgeKind,
  planOrigin,
  planStatus,
  sectionMatchStatus,
} from './enums.js'
import { idShape } from './ids.js'

/**
 * 课程方案与方案门禁（arch/05 §5 阶段三，教师端需求 T6–T8）：
 * 人工目录为骨架（目录先验，不发明章节），方案草案四件套 = 骨架 + 概念图谱
 * + 术语表 + 分节计划；批准锁定基准版，微调结构化生效，打回带意见重起草。
 */

// ---------------------------------------------------------------- 目录树（篇→卷→课时）
export const outlineNodeView = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  level: z.number().int().min(1).max(3),
  parentId: z.string().nullable(),
})

export const courseOutlineView = z.object({ nodes: z.array(outlineNodeView) })

// ---------------------------------------------------------------- 方案草案四件套
/**
 * 一条证据：课时（章节点）覆盖的素材片段，带时间码与讲解要点。
 * 视图层拼装（不落库）——教师据此核对「这一课真的出自我的视频哪几分钟」。
 */
export const planLessonEvidenceView = z.object({
  unitId: z.string().min(1),
  assetId: z.string().min(1),
  assetName: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  points: z.array(z.string()).default([]),
})

export const planSectionNodeView = z.object({
  id: z.string(),
  title: z.string(),
  level: z.number().int().min(1).max(3),
  parentId: z.string().nullable(),
  /** 证据匹配度 0–1；null 表示该章没有任何证据支撑。 */
  matchScore: z.number().min(0).max(1).nullable(),
  matchStatus: sectionMatchStatus,
  /** 该节点绑定的证据单元（source_units.id）：智能规划时按教学要点绑定。 */
  sourceUnitIds: z.array(z.string()).default([]),
  /** 证据明细（视图层拼装）：按 unitId 排序，与 sourceUnitIds 对应。 */
  evidence: z.array(planLessonEvidenceView).default([]),
})

export const planSkeletonView = z.object({ nodes: z.array(planSectionNodeView) })

export const planConceptView = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(20),
  definition: z.string().max(2000).nullable(),
})

export const planConceptEdgeView = z.object({
  fromId: z.string().min(1),
  toId: z.string().min(1),
  kind: conceptEdgeKind,
})

export const planConceptMapView = z.object({
  concepts: z.array(planConceptView),
  edges: z.array(planConceptEdgeView),
})

export const planGlossaryEntryView = z.object({
  term: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(20),
  note: z.string().max(500).nullable(),
})

export const planGlossaryView = z.object({ items: z.array(planGlossaryEntryView) })

export const planLessonView = z.object({
  id: z.string().min(1).max(64),
  /** 挂在骨架哪一章（outline node id）；null 表示未挂靠。 */
  sectionId: z.string().nullable(),
  title: z.string().min(1).max(200),
  subLessonCount: z.number().int().min(1).max(20),
  /** 估时以绑定证据单元的真实跨度为准，没有出处时取模型给的估值（下限 1 分钟）。 */
  estimatedMinutes: z.number().int().min(1).max(240),
  parallelSlot: z.number().int().min(1).max(8),
  /** 该课时覆盖的证据单元（source_units.id）：一课时 = 一个可独立讲清的知识点。 */
  sourceUnitIds: z.array(z.string()).default([]),
  /** 证据明细（视图层拼装）：按 unitId 排序，与 sourceUnitIds 对应。 */
  evidence: z.array(planLessonEvidenceView).default([]),
})

export const planSectionPlanView = z.object({ lessons: z.array(planLessonView) })

/** 拒绝记录（给教师看的理由）：目录外章节 / 重名概念等，草案层已剔除或拦截。 */
export const planViolationView = z.object({
  kind: z.enum(['outline_violation', 'concept_conflict']),
  subject: z.string(),
  reason: z.string(),
  /**
   * true = 已自动处理（剔除 / 还原 / 裁剪），不需要教师裁决，不阻塞批准；
   * false = 待教师裁决，批准前必须先处理掉。
   */
  resolved: z.boolean().default(false),
})

/** 素材覆盖率：规划出的课时覆盖了素材里多少条教学要点（0～1）。 */
export const planCoverageView = z.object({
  coveredPoints: z.number().int().min(0),
  totalPoints: z.number().int().min(0),
  ratio: z.number().min(0).max(1),
})

/**
 * 规划自检的失败项（确定性规则）。
 * 自检不通过的方案不呈现给教师——失败项既给教师看，也回喂给模型重规划。
 */
export const planCheckCodes = [
  'outline_empty',
  'lesson_without_source',
  'unknown_source_unit',
  'duplicate_lesson_title',
  'lesson_count_out_of_range',
  'empty_chapter',
  'empty_part',
  'orphan_node',
  'vague_lesson_title',
  'too_many_nodes',
  'lesson_unattached',
  'lesson_count_mismatch',
] as const
export const planCheckCode = z.enum(planCheckCodes)

export const planCheckIssueView = z.object({
  code: planCheckCode,
  subject: z.string(),
  message: z.string(),
})

/**
 * 规划自检结论：
 * - `pass`：通过，草案可呈现；
 * - `fail`：未通过，正在自动重规划；
 * - `manual`：连续未通过，转人工（教师看到待办，不是坏草案）。
 */
export const planReviewView = z.object({
  id: z.string().regex(idShape.planReview),
  courseId: z.string().regex(idShape.course),
  status: z.enum(['pass', 'fail', 'manual']),
  attempts: z.number().int().min(1),
  issues: z.array(planCheckIssueView),
  createdAt: z.string(),
})

// ---------------------------------------------------------------- 方案视图
export const planView = z.object({
  id: z.string().regex(idShape.plan),
  courseId: z.string().regex(idShape.course),
  version: z.number().int().min(1),
  status: planStatus,
  origin: planOrigin,
  skeleton: planSkeletonView,
  conceptMap: planConceptMapView,
  glossary: planGlossaryView,
  sectionPlan: planSectionPlanView,
  violations: z.array(planViolationView),
  /** 素材覆盖率：null 表示没有可比的素材要点（如未跑理解的素材）。 */
  coverage: planCoverageView.nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const planListResponse = z.object({ items: z.array(planView) })

/** 教师已提交的目标与目录（再次进入方案页时回填表单）。 */
export const planInputView = z.object({
  goal: z.string(),
  outlineText: z.string(),
})

// ---------------------------------------------------------------- 起草任务（轮询）
export const planJobView = z.object({
  id: z.string().regex(idShape.pipelineJob),
  courseId: z.string().regex(idShape.course),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']),
  attempts: z.number().int().min(0),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  updatedAt: z.string(),
})

export const planJobResponse = z.object({ job: planJobView })

// ---------------------------------------------------------------- Agent 执行轨迹（工作台 Agent 面板）

/** 步骤状态：done 完成 / running 进行中 / waiting 等教师确认 / pending 未开始 / failed 失败。 */
export const agentStepStatus = z.enum(['done', 'running', 'waiting', 'pending', 'failed'])

export const agentStepView = z.object({
  key: z.string(),
  label: z.string(),
  status: agentStepStatus,
  metrics: z.array(z.string()),
})

/** 一次模型调用（取自 ai_runs 台账，工作台按阶段归类展示）。 */
export const agentCallView = z.object({
  id: z.string(),
  label: z.string(),
  model: z.string(),
  status: z.enum(['running', 'succeeded', 'failed']),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  latencyMs: z.number().int().nullable(),
  at: z.string(),
})

export const agentMessageView = z.object({
  role: z.enum(['agent', 'user']),
  text: z.string(),
  at: z.string(),
})

export const agentArtifactView = z.object({
  path: z.string(),
  note: z.string(),
})

export const agentTraceView = z.object({
  status: z.enum(['idle', 'running', 'done', 'failed']),
  steps: z.array(agentStepView),
  calls: z.array(agentCallView),
  messages: z.array(agentMessageView),
  artifacts: z.array(agentArtifactView),
})

/**
 * 规划可选素材：教师勾选参与本次规划的素材。
 * pointCount 是素材理解产出的教学要点条数——目录规模由它推导（迭代 8）。
 */
export const planMaterialView = z.object({
  id: z.string(),
  fileName: z.string(),
  durationS: z.number().nullable(),
  /** 理解产出的证据单元数（0 = 还没跑理解，智能规划用不了）。 */
  unitCount: z.number().int().min(0),
  /** 证据单元里的教学要点条数。 */
  pointCount: z.number().int().min(0),
})

export const planResponse = z.object({
  plan: planView.nullable(),
  job: planJobView.nullable(),
  input: planInputView.nullable(),
  /** Agent 执行轨迹（工作台 Agent 面板的对话 / 执行 / 产物三个页签）。 */
  trace: agentTraceView.nullable(),
  /** 课程素材（勾选哪些参与规划）。 */
  materials: z.array(planMaterialView).default([]),
  /** 最近一次规划自检结论（未自检过则 null）。 */
  review: planReviewView.nullable().default(null),
})

// ---------------------------------------------------------------- 请求

/**
 * 规划模式：
 * - `smart`：智能规划——Agent 依据所选素材的教学要点重新规划目录（覆盖人工目录）；
 * - `follow_manual`：沿用人工目录骨架——目录是下界，Agent 只在其上做匹配与分节。
 */
export const planMode = z.enum(['smart', 'follow_manual'])

export const submitPlanInputRequest = z.object({
  goal: z.string().min(1, '课程目标必填').max(2000, '课程目标最长 2000 个字符'),
  /** 人工目录（可留空）：留空则由 Agent 依据目标与素材代拟一版目录先验。 */
  outlineText: z.string().max(20000, '人工目录最长 20000 个字符'),
  /** 占位（本迭代恒 false 不暴露 UI）：素材未全部就绪时是否允许带 partial 起草。 */
  allowPartial: z.boolean().optional().default(false),
  /** 参与本次规划的素材 id；不传 = 课程全部素材。 */
  assetIds: z.array(z.string().min(1)).max(50, '单次最多选 50 份素材').optional(),
  /** 规划模式；不传按「沿用人工目录骨架」处理（目录留空时代拟等价于智能规划）。 */
  mode: planMode.optional(),
})

export const approvePlanRequest = z.object({})

export const rejectPlanRequest = z.object({
  feedback: z.string().min(1, '打回意见必填').max(2000, '打回意见最长 2000 个字符'),
})

/** 结构化微调操作（arch/05 §5 门禁①：微调即时生效，不走 LLM）。 */
export const tweakOps = [
  'rename_chapter',
  'merge_chapters',
  'remove_chapter',
  'add_chapter',
  'move_node',
  'reorder_lessons',
  'set_granularity',
  'add_alias',
] as const
export const tweakOp = z.enum(tweakOps)

export const tweakPlanRequest = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('rename_chapter'),
    nodeId: z.string().min(1),
    title: z.string().min(1, '新标题必填').max(200, '标题最长 200 个字符'),
  }),
  z.object({
    op: z.literal('merge_chapters'),
    nodeIds: z.array(z.string().min(1)).min(2, '合并至少需要两个章节'),
    title: z.string().min(1, '合并后标题必填').max(200, '标题最长 200 个字符'),
  }),
  z.object({ op: z.literal('remove_chapter'), nodeId: z.string().min(1) }),
  z.object({
    op: z.literal('add_chapter'),
    parentId: z.string().nullable(),
    title: z.string().min(1, '章节标题必填').max(200, '标题最长 200 个字符'),
  }),
  z.object({
    op: z.literal('move_node'),
    nodeId: z.string().min(1),
    /** 新的父节点；null = 移到顶级（篇）。章只能挂篇，课时只能挂章。 */
    newParentId: z.string().nullable(),
    /** 在新父节点下的位置（0 起）；超出则追加到末尾。 */
    position: z.number().int().min(0).default(0),
  }),
  z.object({
    op: z.literal('reorder_lessons'),
    /** 课时的目标顺序（必须是现有课时的全排列）。 */
    lessonIds: z.array(z.string().min(1)).min(1, '至少要有一个课时'),
  }),
  z.object({
    op: z.literal('set_granularity'),
    lessonId: z.string().min(1),
    subLessonCount: z.number().int().min(1, '子节数至少 1').max(20, '子节数最多 20'),
  }),
  z.object({
    op: z.literal('add_alias'),
    conceptId: z.string().min(1),
    alias: z.string().min(1, '别名必填').max(120, '别名最长 120 个字符'),
  }),
])

// ---------------------------------------------------------------- 概念（批准后落库，只读）
export const conceptView = z.object({
  id: z.string().regex(idShape.concept),
  courseId: z.string().regex(idShape.course),
  name: z.string(),
  aliases: z.array(z.string()),
  definition: z.string().nullable(),
  createdAt: z.string(),
})

export const conceptEdgeRecordView = z.object({
  id: z.string().regex(idShape.concept),
  fromConceptId: z.string().regex(idShape.concept),
  toConceptId: z.string().regex(idShape.concept),
  kind: conceptEdgeKind,
})

export const conceptsResponse = z.object({
  items: z.array(conceptView),
  edges: z.array(conceptEdgeRecordView),
})

export type OutlineNodeView = z.infer<typeof outlineNodeView>
export type CourseOutlineView = z.infer<typeof courseOutlineView>
export type PlanSectionNodeView = z.infer<typeof planSectionNodeView>
export type PlanLessonEvidenceView = z.infer<typeof planLessonEvidenceView>
export type PlanSkeletonView = z.infer<typeof planSkeletonView>
export type PlanConceptView = z.infer<typeof planConceptView>
export type PlanConceptEdgeView = z.infer<typeof planConceptEdgeView>
export type PlanConceptMapView = z.infer<typeof planConceptMapView>
export type PlanGlossaryView = z.infer<typeof planGlossaryView>
export type PlanSectionPlanView = z.infer<typeof planSectionPlanView>
export type PlanViolationView = z.infer<typeof planViolationView>
export type PlanCheckCode = z.infer<typeof planCheckCode>
export type PlanCheckIssueView = z.infer<typeof planCheckIssueView>
export type PlanReviewView = z.infer<typeof planReviewView>
export type PlanView = z.infer<typeof planView>
export type PlanCoverageView = z.infer<typeof planCoverageView>
export type PlanMode = z.infer<typeof planMode>
export type PlanInputView = z.infer<typeof planInputView>
export type PlanJobView = z.infer<typeof planJobView>
export type PlanResponse = z.infer<typeof planResponse>
export type PlanMaterialView = z.infer<typeof planMaterialView>
export type AgentStepStatus = z.infer<typeof agentStepStatus>
export type AgentStepView = z.infer<typeof agentStepView>
export type AgentCallView = z.infer<typeof agentCallView>
export type AgentMessageView = z.infer<typeof agentMessageView>
export type AgentArtifactView = z.infer<typeof agentArtifactView>
export type AgentTraceView = z.infer<typeof agentTraceView>
export type SubmitPlanInputRequest = z.infer<typeof submitPlanInputRequest>
export type RejectPlanRequest = z.infer<typeof rejectPlanRequest>
export type TweakOp = z.infer<typeof tweakOp>
export type TweakPlanRequest = z.infer<typeof tweakPlanRequest>
export type ConceptView = z.infer<typeof conceptView>
export type ConceptEdgeRecordView = z.infer<typeof conceptEdgeRecordView>
export type ConceptsResponse = z.infer<typeof conceptsResponse>
