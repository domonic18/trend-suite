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
export const planSectionNodeView = z.object({
  id: z.string(),
  title: z.string(),
  level: z.number().int().min(1).max(3),
  parentId: z.string().nullable(),
  /** 证据匹配度 0–1；null 表示该章没有任何证据支撑。 */
  matchScore: z.number().min(0).max(1).nullable(),
  matchStatus: sectionMatchStatus,
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
  estimatedMinutes: z.number().int().min(5).max(240),
  parallelSlot: z.number().int().min(1).max(8),
})

export const planSectionPlanView = z.object({ lessons: z.array(planLessonView) })

/** 拒绝记录（给教师看的理由）：目录外章节 / 重名概念等，草案层已剔除或拦截。 */
export const planViolationView = z.object({
  kind: z.enum(['outline_violation', 'concept_conflict']),
  subject: z.string(),
  reason: z.string(),
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

export const planResponse = z.object({
  plan: planView.nullable(),
  job: planJobView.nullable(),
  input: planInputView.nullable(),
  /** Agent 执行轨迹（工作台 Agent 面板的对话 / 执行 / 产物三个页签）。 */
  trace: agentTraceView.nullable(),
})

// ---------------------------------------------------------------- 请求
export const submitPlanInputRequest = z.object({
  goal: z.string().min(1, '课程目标必填').max(2000, '课程目标最长 2000 个字符'),
  /** 人工目录（可留空）：留空则由 Agent 依据目标与素材代拟一版目录先验。 */
  outlineText: z.string().max(20000, '人工目录最长 20000 个字符'),
  /** 占位（本迭代恒 false 不暴露 UI）：素材未全部就绪时是否允许带 partial 起草。 */
  allowPartial: z.boolean().optional().default(false),
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
export type PlanSkeletonView = z.infer<typeof planSkeletonView>
export type PlanConceptView = z.infer<typeof planConceptView>
export type PlanConceptEdgeView = z.infer<typeof planConceptEdgeView>
export type PlanConceptMapView = z.infer<typeof planConceptMapView>
export type PlanGlossaryView = z.infer<typeof planGlossaryView>
export type PlanSectionPlanView = z.infer<typeof planSectionPlanView>
export type PlanViolationView = z.infer<typeof planViolationView>
export type PlanView = z.infer<typeof planView>
export type PlanInputView = z.infer<typeof planInputView>
export type PlanJobView = z.infer<typeof planJobView>
export type PlanResponse = z.infer<typeof planResponse>
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
