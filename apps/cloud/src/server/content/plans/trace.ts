import 'server-only'
import type { AgentCallView, AgentStepView, AgentTraceView } from '@trend-suite/contracts'
import { query } from '@/server/lib/db'
import { listAssetsByCourse } from '@/server/pipeline/repo'
import * as repo from './repo'

/**
 * Agent 执行轨迹（arch/05 §5 阶段三 + 原型 teacher-plan 的 Agent 面板）：
 * 把「排队 → 读素材 → 代拟目录 → 综合起草 → 校验 → 等你确认」的真实过程
 * 摊开给教师看。数据全部来自既有台账（ai_runs / pipeline_jobs / 方案行），
 * 不另存一份轨迹——面板只是这些真相的视图。
 */

type RunRow = {
  id: string
  model: string | null
  status: 'running' | 'succeeded' | 'failed'
  tokens_in: number | null
  tokens_out: number | null
  latency_ms: number | null
  summary: string | null
  created_at: Date
}

/** 阶段前缀由调用方写进 ai_runs.summary（llm.ts 的 phase 参数）。 */
type Phase = 'outline' | 'draft'

function phaseOf(summary: string | null): Phase | null {
  if (!summary) return null
  if (summary.startsWith('outline:')) return 'outline'
  if (summary.startsWith('draft:')) return 'draft'
  return null
}

const PHASE_LABEL: Record<Phase, string> = {
  outline: '目录代拟',
  draft: '综合起草',
}

function bodyOf(summary: string | null): string {
  if (!summary) return ''
  const cut = summary.indexOf(': ')
  return cut >= 0 ? summary.slice(cut + 2) : summary
}

/** 从 summary 的 key=value 里取数值（如 nodes=40 concepts=26）。 */
function metric(summary: string | null, key: string): number | null {
  const match = new RegExp(`(?:^|\\s)${key}=(\\d+)`).exec(bodyOf(summary))
  return match ? Number(match[1]) : null
}

function listRuns(courseId: string): Promise<RunRow[]> {
  return query<RunRow>(
    `SELECT id, model, status, tokens_in, tokens_out, latency_ms, summary, created_at
     FROM ai_runs
     WHERE task_key = 'content.curriculum' AND ref_id = $1
     ORDER BY created_at ASC`,
    [courseId],
  )
}

/** 一个阶段的状态：成功过就是 done；正在跑是 running；只有失败是 failed；否则 pending。 */
function phaseStatus(runs: RunRow[], phase: Phase): 'done' | 'running' | 'failed' | 'pending' {
  const scoped = runs.filter((run) => phaseOf(run.summary) === phase)
  if (scoped.length === 0) return 'pending'
  if (scoped.some((run) => run.status === 'succeeded')) return 'done'
  const last = scoped[scoped.length - 1]
  if (last && last.status === 'running') return 'running'
  return 'failed'
}

function phaseSummary(runs: RunRow[], phase: Phase): string | null {
  const scoped = runs.filter((run) => phaseOf(run.summary) === phase)
  const succeeded = scoped.filter((run) => run.status === 'succeeded')
  const last = succeeded[succeeded.length - 1] ?? scoped[scoped.length - 1]
  return last?.summary ?? null
}

function countNodes(skeleton: unknown): number {
  const nodes = (skeleton as { nodes?: unknown[] } | null)?.nodes
  return Array.isArray(nodes) ? nodes.length : 0
}

function countConcept(conceptMap: unknown): number {
  const concepts = (conceptMap as { concepts?: unknown[] } | null)?.concepts
  return Array.isArray(concepts) ? concepts.length : 0
}

function countGlossary(glossary: unknown): number {
  const items = (glossary as { items?: unknown[] } | null)?.items
  return Array.isArray(items) ? items.length : 0
}

function countLessons(sectionPlan: unknown): number {
  const lessons = (sectionPlan as { lessons?: unknown[] } | null)?.lessons
  return Array.isArray(lessons) ? lessons.length : 0
}

export type TraceInput = {
  courseId: string
  plan: repo.CoursePlanRow | null
  job: { status: string; attempts: number; step: string | null; errorMessage: string | null } | null
  input: { goal: string | null; outlineText: string | null; submittedAt: Date | null }
}

export async function buildAgentTrace(input: TraceInput): Promise<AgentTraceView> {
  const { courseId, plan, job } = input
  const [runs, assets, lines] = await Promise.all([
    listRuns(courseId),
    listAssetsByCourse(courseId),
    repo.listTranscriptLines(courseId),
  ])
  const ready = assets.filter((asset) => asset.status === 'ready').length
  const jobRunning = job?.status === 'queued' || job?.status === 'running'

  // 目录来源：有 outline 阶段的模型调用 = Agent 代拟（代拟结果会回写 outline_text，
  // 不能只看当前文本非空）；否则教师人工目录。
  const outlineRuns = runs.filter((run) => phaseOf(run.summary) === 'outline')
  const agentOutlined = outlineRuns.length > 0
  const humanOutline = !agentOutlined && (input.input.outlineText ?? '').trim().length > 0

  const outlineStatus: AgentStepView['status'] = agentOutlined
    ? phaseStatus(runs, 'outline')
    : humanOutline
      ? 'done'
      : 'pending'
  const draftStatus = phaseStatus(runs, 'draft')

  // 阶段推进：读到 job.step（corpus / outlining / drafting / validating）。
  const currentStep = job?.step ?? null
  const corpusStatus: AgentStepView['status'] =
    plan || runs.length > 0
      ? 'done'
      : currentStep === 'corpus' && jobRunning
        ? 'running'
        : 'pending'

  const outlineMetrics: string[] = []
  const outlineSummary = phaseSummary(runs, 'outline')
  const outlineSections = metric(outlineSummary, 'sections')
  if (outlineSections != null) outlineMetrics.push(`${outlineSections} 条目录`)
  if (humanOutline) outlineMetrics.push('教师人工目录')

  const draftMetrics: string[] = []
  const draftSummary = phaseSummary(runs, 'draft')
  const nodes = metric(draftSummary, 'nodes')
  const concepts = metric(draftSummary, 'concepts')
  const edges = metric(draftSummary, 'edges')
  const lessons = metric(draftSummary, 'lessons')
  if (nodes != null) draftMetrics.push(`${nodes} 个目录节点`)
  if (concepts != null) draftMetrics.push(`${concepts} 个概念`)
  if (edges != null) draftMetrics.push(`${edges} 条依赖`)
  if (lessons != null) draftMetrics.push(`${lessons} 条分节`)

  const validateMetrics: string[] = []
  if (plan) {
    validateMetrics.push(`${countNodes(plan.skeleton)} 个节点`)
    validateMetrics.push(`${countConcept(plan.concept_map)} 个概念`)
    validateMetrics.push(`${countGlossary(plan.glossary)} 条术语`)
    validateMetrics.push(`${countLessons(plan.section_plan)} 条分节`)
  }

  const steps: AgentStepView[] = [
    {
      key: 'corpus',
      label: '读取素材与转写语料',
      status: corpusStatus,
      metrics: [`${ready}/${assets.length} 份素材就绪`, `${lines.length} 段转写`],
    },
    {
      key: 'outline',
      label: agentOutlined ? 'Agent 代拟目录' : humanOutline ? '目录先验（人工目录）' : '目录先验',
      status: outlineStatus,
      metrics: outlineMetrics,
    },
    {
      key: 'draft',
      label: '起草方案四件套',
      status: draftStatus,
      metrics: draftMetrics,
    },
    {
      key: 'validate',
      label: '目录与概念校验',
      status: plan ? 'done' : draftStatus === 'done' ? 'running' : 'pending',
      metrics: validateMetrics,
    },
    {
      key: 'confirm',
      label: '等你确认',
      status: plan ? (plan.status === 'approved' ? 'done' : 'waiting') : 'pending',
      metrics: plan ? [`方案 v${plan.version}`] : [],
    },
  ]

  const calls: AgentCallView[] = runs.map((run) => {
    const phase = phaseOf(run.summary)
    return {
      id: run.id,
      label: phase ? PHASE_LABEL[phase] : '模型调用',
      model: run.model ?? '未记录',
      status: run.status,
      tokensIn: run.tokens_in,
      tokensOut: run.tokens_out,
      latencyMs: run.latency_ms,
      at: run.created_at.toISOString(),
    }
  })

  // 对话流：由真实执行事实生成，不编造 Agent 说过的话。
  const messages: AgentTraceView['messages'] = []
  if (input.input.goal && input.input.submittedAt) {
    messages.push({
      role: 'user',
      text: input.input.goal,
      at: input.input.submittedAt.toISOString(),
    })
  }
  // 打回重起草：教师给 Agent 的修改意见也进对话流。
  if (plan?.origin === 'revision' && plan.trigger_note) {
    messages.push({
      role: 'user',
      text: plan.trigger_note,
      at: plan.created_at.toISOString(),
    })
  }
  if (corpusStatus === 'done') {
    messages.push({
      role: 'agent',
      text: `已读取 ${ready}/${assets.length} 份就绪素材、${lines.length} 段转写语料。`,
      at: (runs[0]?.created_at ?? plan?.created_at ?? new Date()).toISOString(),
    })
  }
  if (outlineSummary && outlineStatus === 'done') {
    const sections = metric(outlineSummary, 'sections')
    messages.push({
      role: 'agent',
      text: `已代拟课程目录${sections != null ? `（${sections} 条）` : ''}，作为课程骨架的下界。`,
      at: (runs.find((run) => phaseOf(run.summary) === 'outline')?.created_at ?? new Date()).toISOString(),
    })
  }
  if (draftStatus === 'done' && plan) {
    messages.push({
      role: 'agent',
      text: `方案草案已生成：${countNodes(plan.skeleton)} 个目录节点、${countConcept(plan.concept_map)} 个概念、${countGlossary(plan.glossary)} 条术语、${countLessons(plan.section_plan)} 条分节计划。`,
      at: plan.updated_at.toISOString(),
    })
  }
  if (job?.status === 'failed') {
    messages.push({
      role: 'agent',
      text: `起草未完成：${job.errorMessage ?? '未知原因'}（已尝试 ${job.attempts} 次）。`,
      at: new Date().toISOString(),
    })
  }
  if (plan && plan.status !== 'approved') {
    messages.push({
      role: 'agent',
      text: '方案已就绪，请审阅后批准 / 微调 / 打回。',
      at: plan.updated_at.toISOString(),
    })
  }
  if (plan?.status === 'approved') {
    messages.push({
      role: 'agent',
      text: `方案 v${plan.version} 已锁定为基准版，逐节生产已解锁。`,
      at: plan.updated_at.toISOString(),
    })
  }

  const artifacts: AgentTraceView['artifacts'] = []
  if (plan) {
    artifacts.push(
      { path: `plan/v${plan.version}.md`, note: plan.status === 'approved' ? '基准版' : 'draft' },
      { path: 'plan/outline.md', note: `${countNodes(plan.skeleton)} 个节点` },
      { path: 'plan/concepts.json', note: `${countConcept(plan.concept_map)} 个概念` },
      { path: 'plan/glossary.md', note: `${countGlossary(plan.glossary)} 条术语` },
      { path: 'plan/sections.json', note: `${countLessons(plan.section_plan)} 条分节` },
    )
  }
  artifacts.push({ path: 'units/', note: `${lines.length} 段转写语料` })

  const status: AgentTraceView['status'] = job?.status === 'failed'
    ? 'failed'
    : plan
      ? 'done'
      : jobRunning
        ? 'running'
        : runs.length > 0
          ? 'done'
          : 'idle'

  return { status, steps, calls, messages, artifacts }
}
