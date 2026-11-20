import 'server-only'
import { z } from 'zod'
import {
  buildOutlineFromSections,
  parseOutlineText,
  stripOutlineNumbering,
  type CourseOutlineView,
  type OutlineNode,
  type PlanCheckIssueView,
  type PlanConceptMapView,
  type PlanGlossaryView,
  type PlanSkeletonView,
  type PlanViolationView,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { findCourseById } from '../repo'
import * as jobs from '@/server/pipeline/jobs/repo'
import type { PipelineJobRow } from '@/server/pipeline/jobs/repo'
import { listAssetsByCourse } from '@/server/pipeline/repo'
import { listSourceUnitsByCourse } from '@/server/pipeline/processing/repo'
import { runLlmJson, LlmError } from '../agents/llm'
import {
  buildSkeleton,
  deriveMatchesFromUnits,
  parseStoredOutline,
  trimOutlineToBudget,
  type OutlineMatch,
} from './outline'
import { validateConceptMap, glossaryOf } from './concepts'
import {
  buildPlanningUnits,
  deriveLessonBudget,
  deriveTotalMinutes,
  formatPlanningUnits,
  totalPoints,
  MAX_POINTS_PER_LESSON,
  MIN_POINTS_PER_LESSON,
  type PlanningUnit,
} from './planning'
import { buildLessonsFromOutline } from './lessons'
import { checkPlanDraft, formatCheckIssues } from './selfcheck'
import * as repo from './repo'
import type { PlanLesson } from './tweak'

/**
 * 方案起草 worker 入口（arch/05 §5 阶段三）：join 课程目标 + 人工目录 + 就绪素材
 * 转写语料 → LLM 产 JSON → 目录/概念校验 → 回写草案行。打回重起草不重跑素材理解，
 * 只追加教师意见。失败经 failJob 走队列退避（LlmError.retryable）。
 */

const CURRICULUM_TASK = 'content.curriculum'
/**
 * 综合起草的 token 上限：推理型模型的思考与正文共用 max_tokens 预算，
 * 目录较大时思考可能吃掉 10K+，16K 会把 JSON 截断（实测连续三次撞满 16000）。
 */
const MAX_TOKENS = 32_000
/** 转写语料字符上限：超长课程按序截断（标记省略），避免单请求超上下文。 */
const CORPUS_MAX_CHARS = 48_000

const draftOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        nodeId: z.string(),
        /** 缺省即「无证据支撑」：模型漏写该键不该让整轮起草报废（null 本就是合法取值）。 */
        matchScore: z.number().min(0).max(1).nullable().default(null),
      }),
    )
    .default([]),
  concepts: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        definition: z.string().nullable().default(null),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        kind: z.string(),
      }),
    )
    .default([]),
  lessons: z
    .array(
      z.object({
        sectionId: z.string().nullable().default(null),
        title: z.string().min(1),
        subLessonCount: z.number().int(),
        estimatedMinutes: z.number().int(),
        parallelSlot: z.number().int(),
        /** 该课时覆盖的证据单元 id（智能规划输入里给过的那批）。 */
        sourceUnitIds: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

/** Agent 代拟目录的结构（篇=1 / 章=2 / 课时=3）。 */
const outlineDraftSchema = z.object({
  sections: z
    .array(
      z.object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        title: z.string().min(1),
        /** 课时级条目覆盖的证据单元 id（智能规划时逐条绑定出处）。 */
        sourceUnitIds: z.array(z.string()).default([]),
      }),
    )
    .max(200, '目录条目过多')
    .default([]),
})

/**
 * 代拟目录的 token 上限：推理型模型的思考与正文共用 max_tokens 预算，
 * 4K 会被思考吃光导致 JSON 截断——给足余量（综合方案那步是 16K）。
 */
const OUTLINE_MAX_TOKENS = 12_000

function msToClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function buildCorpus(lines: repo.TranscriptLineRow[]): string {
  const parts: string[] = []
  let used = 0
  for (const line of lines) {
    const name = line.original_name ?? '素材'
    const part = `【${name} ${msToClock(line.start_ms)}】${line.text}\n`
    if (used + part.length > CORPUS_MAX_CHARS) {
      parts.push(`（语料过长，已截断：仅保留前 ${parts.length} 段）\n`)
      break
    }
    parts.push(part)
    used += part.length
  }
  return parts.join('')
}

function buildPrompt(input: {
  mode: 'smart' | 'follow_manual'
  goal: string
  outlineNodes: { id: string; title: string }[]
  corpus: string
  feedback: string | null
  units: PlanningUnit[]
  budget: { min: number; max: number; target: number } | null
}): { system: string; user: string } {
  const smart = input.mode === 'smart'
  const hasUnits = input.units.length > 0
  const system = [
    '你是课程方案起草助手。根据课程目标、目录与素材证据，产出课程方案草案。',
    '规则：',
    smart
      ? '1. 目录已经定稿（智能规划产出），matches 不需要你判断——证据出处已随目录给出，你只输出 concepts、edges、lessons。'
      : '1. 严格目录先验：目录是骨架的唯一来源，不得发明目录外章节；lessons 只为目录里的课时级节点生成，标题沿用目录原文。matches 只允许引用目录给出的 nodeId，目录中每个节点都要有匹配条目，无证据的节点 matchScore 用 null。matchScore 为 0～1 的证据匹配度，表示该章节有多少素材内容支撑。',
    '2. concepts 收录课程核心概念：name 唯一、definition 一句话；同义表述放 aliases。',
    '3. edges 按概念名引用（from/to 必须是 concepts 里的 name），kind 只能是 prerequisite（先修）或 related（相关）；不要制造循环先修。',
    '4. lessons 为分节计划：每条对应一个课时级章节（sectionId 引用目录 nodeId，无法对应时用 null），title 为课时标题，subLessonCount 1～20，estimatedMinutes 1～240，parallelSlot 1～8。',
    hasUnits
      ? '5. 每个课时必须给出 sourceUnitIds：只引用「素材讲解要点」里出现过的证据单元 id，至少 1 个；一个课时只讲一个可独立讲清的知识点，因此通常 1～3 个单元。'
      : '5. lessons 只为课时级章节生成。',
    '6. 规模上限（避免输出被截断）：concepts ≤ 25 条且 definition ≤ 40 字；edges ≤ 30 条；lessons ≤ 40 条。',
    '只输出一个 JSON 对象，字段：matches、concepts、edges、lessons，不要输出任何其他文字。',
  ].join('\n')

  const outlineList = input.outlineNodes.map((node) => `${node.id}: ${node.title}`).join('\n')
  const user = [
    `## 课程目标\n${input.goal}`,
    `## 目录（id: 标题）\n${outlineList}`,
    input.feedback ? `## 上一版教师意见（本次起草须吸收）\n${input.feedback}` : null,
    hasUnits
      ? `## 素材讲解要点（每条带证据单元 id 与时间码）\n${formatPlanningUnits(input.units)}`
      : `## 素材转写语料\n${input.corpus || '（无转写语料）'}`,
    smart && input.budget
      ? `## 规模边界\n本课素材共 ${totalPoints(input.units)} 条讲解要点，课时数必须在 ${input.budget.min}～${input.budget.max} 之间（目标 ${input.budget.target}）。`
      : null,
  ]
    .filter((section) => section !== null)
    .join('\n\n')
  return { system, user }
}

/**
 * 目录先验（人工目录）缺失时的兜底：按已存的目录树取；目录树与文本都不可用
 * 则返回 null（由调用方决定代拟还是失败）。
 *
 * 教师原文优先：智能规划只换工作目录树，不动教师粘贴的原文——
 * 回到「沿用人工目录骨架」时，用的还是教师自己那份。
 */
function resolveOutline(inputRow: repo.CoursePlanInputRow): CourseOutlineView | null {
  const text = (inputRow.outline_text ?? '').trim()
  if (text.length > 0) {
    const { nodes, issues } = parseOutlineText(text)
    if (issues.length === 0) return { nodes }
  }
  return parseStoredOutline(inputRow.outline)
}

/** 语料兜底的代拟提示词：素材没有理解结果时仍能起草（质量不如要点驱动）。 */
function buildCorpusOutlinePrompt(input: {
  goal: string
  corpus: string
  feedback: string | null
}): { system: string; user: string } {
  const system = [
    '你是课程目录设计助手。根据课程目标与素材转写语料，设计这门课的三级目录。',
    '规则：',
    '1. 只设计素材能支撑的章节，不得超出素材范围发明章节——目录是课程骨架的下界。',
    '2. 层级：1=篇（课程主题块），2=章，3=课时（一个能独立讲清的知识点）。',
    '3. 课时标题写成一个可讲清的知识点，不要写「概述」「介绍」这类空话。',
    '4. 标题不要自带编号，编号由系统统一生成。',
    '5. 规模上限：最多 3 篇、每篇最多 8 章、每章最多 8 课时，总数不超过 40 条；每个标题不超过 20 字。',
    '只输出一个 JSON 对象：{"sections":[{"level":1,"title":"...","sourceUnitIds":[]}]}，不要输出任何其他文字。',
  ].join('\n')
  const user = [
    `## 课程目标\n${input.goal}`,
    input.feedback ? `## 上一版教师意见（本次须吸收）\n${input.feedback}` : null,
    `## 素材转写语料\n${input.corpus || '（无转写语料）'}`,
  ]
    .filter((section) => section !== null)
    .join('\n\n')
  return { system, user }
}

/**
 * 要点驱动的智能规划提示词（迭代 8）。
 *
 * 目录规模由素材推导（规模边界写进提示词），每个课时必须给出出处——
 * 出处是后面「素材覆盖率」与「证据不足」判定的唯一依据。
 */
function buildSmartOutlinePrompt(input: {
  goal: string
  units: PlanningUnit[]
  budget: { min: number; max: number; target: number }
  feedback: string | null
}): { system: string; user: string } {
  const system = [
    '你是课程目录设计助手。根据课程目标与素材的「讲解要点」清单，设计这门课的三级目录。',
    '规则：',
    '1. 一课时 = 一个可独立讲清的知识点。标题写知识点本身，不要写「概述」「介绍」「总结」「第一部分」这类空话或目录词。',
    '2. 目录只能覆盖要点清单里的内容——清单里没有的知识点不要编。',
    '3. 层级：1=篇（课程主题块），2=章，3=课时。',
    '4. 每个课时条目必须给出它覆盖的证据单元 id（sourceUnitIds），至少 1 个，且只能引用清单里出现过的 id。',
    `5. 课时总数必须落在规模边界内（素材规模决定课时数，不要凭想象铺开）；每个课时覆盖 ${MIN_POINTS_PER_LESSON}～${MAX_POINTS_PER_LESSON} 条要点，不要把多个知识点塞进一个课时。`,
    '6. 标题不要自带编号，编号由系统统一生成；每个标题不超过 20 字。',
    '只输出一个 JSON 对象：{"sections":[{"level":1,"title":"...","sourceUnitIds":["su_..."]}]}，不要输出任何其他文字。',
  ].join('\n')
  const user = [
    `## 课程目标\n${input.goal}`,
    input.feedback ? `## 上一版教师意见（本次须吸收）\n${input.feedback}` : null,
    `## 素材讲解要点（每条带证据单元 id 与时间码）\n${formatPlanningUnits(input.units)}`,
    `## 规模边界\n素材共 ${totalPoints(input.units)} 条讲解要点，课时数必须在 ${input.budget.min}～${input.budget.max} 之间（目标 ${input.budget.target}）。`,
  ]
    .filter((section) => section !== null)
    .join('\n\n')
  return { system, user }
}

/** Agent 代拟目录 → 规范目录文本 + 目录树（文本与树同源，见 contracts outline.ts）。 */
async function draftOutline(input: {
  courseId: string
  goal: string
  corpus: string
  feedback: string | null
  units: PlanningUnit[]
  budget: { min: number; max: number; target: number } | null
}): Promise<{ text: string; nodes: OutlineNode[]; unitIdsByNodeId: Map<string, string[]> }> {
  const smart = input.units.length > 0 && input.budget !== null
  const prompt = smart
    ? buildSmartOutlinePrompt({
        goal: input.goal,
        units: input.units,
        budget: input.budget!,
        feedback: input.feedback,
      })
    : buildCorpusOutlinePrompt({ goal: input.goal, corpus: input.corpus, feedback: input.feedback })
  const { data } = await runLlmJson({
    task: CURRICULUM_TASK,
    purpose: 'llm',
    refType: 'course',
    refId: input.courseId,
    system: prompt.system,
    user: prompt.user,
    maxTokens: OUTLINE_MAX_TOKENS,
    schema: outlineDraftSchema,
    phase: 'outline',
    summarize: (out) => `sections=${out.sections.length}`,
  })
  // 空标题的条目不进目录（渲染时会跳过），先滤掉再与目录树按序对齐。
  const sections = data.sections.filter(
    (section) => stripOutlineNumbering(section.title).length > 0,
  )
  const { text, nodes } = buildOutlineFromSections(
    sections.map((section) => ({ level: section.level, title: section.title })),
  )
  const unitIdsByNodeId = new Map<string, string[]>()
  nodes.forEach((node, index) => {
    unitIdsByNodeId.set(node.id, sections[index]?.sourceUnitIds ?? [])
  })
  return { text, nodes, unitIdsByNodeId }
}

/** 规划自检的最大尝试次数：不通过的方案不呈现给教师，自动重规划 ≤3 次后转人工。 */
const MAX_PLAN_ATTEMPTS = 3

/** 一次规划尝试的产物：自检通过后才落库。 */
type DraftAttempt = {
  outline: CourseOutlineView
  unitIdsByNodeId: Map<string, string[]>
  skeleton: PlanSkeletonView
  conceptMap: PlanConceptMapView
  glossary: PlanGlossaryView
  lessons: PlanLesson[]
  violations: PlanViolationView[]
  runId: string
  /** Agent 代拟出的目录文本（沿用人工目录骨架时才回写）。 */
  draftedText: string
  /** 本次是否真的代拟了目录（教师已有目录则不动教师那份）。 */
  draftedOutline: boolean
}

/** worker 分派入口：跑一个 curriculum_draft 任务。 */
export async function runCurriculumDraft(job: PipelineJobRow): Promise<void> {
  const courseId = job.course_id
  if (!courseId) {
    await jobs.failJob({ jobId: job.id, code: 'course_not_found', message: '任务未挂课程', retryable: false })
    return
  }
  try {
    const course = await findCourseById(courseId)
    if (!course) {
      await jobs.failJob({ jobId: job.id, code: 'course_not_found', message: '课程不存在', retryable: false })
      return
    }
    const inputRow = await repo.findCoursePlanInput(courseId)
    if (!inputRow?.goal) {
      await jobs.failJob({
        jobId: job.id,
        code: 'plan_input_missing',
        message: '课程目标缺失，无法起草',
        retryable: false,
      })
      return
    }
    const goal = inputRow.goal

    await jobs.updateJobProgress({ jobId: job.id, step: 'corpus', progress: 10 })
    const lines = await repo.listTranscriptLines(courseId)
    const corpus = buildCorpus(lines)
    const draft = await repo.findDraftPlan(courseId)
    const teacherFeedback = draft?.origin === 'revision' ? draft.trigger_note : null

    // 参与规划的素材：教师勾选的子集（不勾 = 课程全部素材）。
    const assets = await listAssetsByCourse(courseId)
    const selectedIds = inputRow.plan_asset_ids
    const selected =
      selectedIds && selectedIds.length > 0
        ? assets.filter((asset) => selectedIds.includes(asset.id))
        : assets
    const selectedIdSet = new Set(selected.map((asset) => asset.id))
    const assetNames = new Map(assets.map((asset) => [asset.id, asset.original_name ?? '素材']))
    const assetDurations = new Map(
      assets.map((asset) => [asset.id, asset.duration_s === null ? null : Number(asset.duration_s)]),
    )
    const unitRows = await listSourceUnitsByCourse(courseId)
    const units = buildPlanningUnits(
      unitRows.filter((row) => selectedIdSet.has(row.asset_id)),
      assetNames,
    )
    const totalMinutes = deriveTotalMinutes(units, assetDurations)
    const budget = units.length > 0 ? deriveLessonBudget({ pointCount: totalPoints(units), totalMinutes }) : null

    const mode = inputRow.plan_mode === 'smart' ? 'smart' : 'follow_manual'

    // 智能规划的前提是素材有理解结果：没有要点就没法推导规模与出处，
    // 与其让模型凭空编，不如明确告诉教师去重跑理解。
    if (mode === 'smart' && units.length === 0) {
      await jobs.failJob({
        jobId: job.id,
        code: 'material_not_understood',
        message: '所选素材还没有理解结果，无法智能规划；请到素材页点「重跑理解」后再试',
        retryable: false,
      })
      return
    }

    const knownUnitIds = new Set(units.map((unit) => unit.id))

    /** 跑一轮规划（目录 + 方案），产出自检用的完整产物；不落库。 */
    const draftOnce = async (feedback: string | null): Promise<DraftAttempt | null> => {
      // 目录先验：人工目录优先；智能规划重排目录；都没有则 Agent 代拟一版。
      let outline = mode === 'smart' ? null : resolveOutline(inputRow)
      let unitIdsByNodeId = new Map<string, string[]>()
      const scaleViolations: PlanViolationView[] = []
      let draftedText = ''
      let draftedOutline = false

      if (!outline) {
        await jobs.updateJobProgress({ jobId: job.id, step: 'outlining', progress: 20 })
        const drafted = await draftOutline({
          courseId,
          goal,
          corpus,
          feedback,
          units,
          budget,
        })
        if (drafted.nodes.length === 0) return null
        outline = { nodes: drafted.nodes }
        unitIdsByNodeId = drafted.unitIdsByNodeId
        draftedText = drafted.text
        draftedOutline = true
        // 规模裁剪：模型给的课时数超出素材推导的上限时裁掉多出来的，并留痕。
        // 只裁「Agent 代拟的」目录——教师粘贴的目录是目录先验，一个字都不动。
        if (budget) {
          const trimmed = trimOutlineToBudget(outline, budget.max)
          if (trimmed.trimmed > 0) {
            outline = trimmed.outline
            scaleViolations.push({
              kind: 'outline_violation',
              subject: '规划规模',
              reason: `课时数超出素材推导的上限（${budget.max} 课时），已裁掉 ${trimmed.trimmed} 个`,
              resolved: true,
            })
          }
        }
      }

      await jobs.updateJobProgress({ jobId: job.id, step: 'drafting', progress: 30 })
      const prompt = buildPrompt({
        mode,
        goal,
        outlineNodes: outline.nodes,
        corpus,
        feedback,
        units,
        budget,
      })
      const { data, runId } = await runLlmJson({
        task: CURRICULUM_TASK,
        purpose: 'llm',
        refType: 'course',
        refId: courseId,
        system: prompt.system,
        user: prompt.user,
        maxTokens: MAX_TOKENS,
        schema: draftOutputSchema,
        phase: 'draft',
        summarize: (out) =>
          `nodes=${outline.nodes.length} matches=${out.matches.length} concepts=${out.concepts.length} edges=${out.edges.length} lessons=${out.lessons.length} units=${units.length}`,
      })

      await jobs.updateJobProgress({ jobId: job.id, step: 'validating', progress: 70 })
      // 顺序要紧：先按目录把课时与出处归位，再由出处推导匹配度——
      // 出处晚于匹配度推导时，人工目录模式下每一行都会变成「无证据支撑」。
      const built = buildLessonsFromOutline({
        outline,
        modelLessons: data.lessons,
        units,
        knownUnitIds,
        unitIdsByNodeId,
      })
      unitIdsByNodeId = built.unitIdsByNodeId
      const derived = deriveMatchesFromUnits(outline, unitIdsByNodeId)
      const derivedById = new Map(derived.map((match) => [match.nodeId, match.matchScore]))
      const modelScoreById = new Map(data.matches.map((match) => [match.nodeId, match.matchScore]))
      // 有出处以出处为准（两种模式同口径）；人工目录模式下没有出处的节点
      // 用模型的语料判断兜底，别让整页都飘红。
      const resolvedById = new Map<string, number | null>()
      for (const node of outline.nodes) {
        const derivedScore = derivedById.get(node.id) ?? null
        if (mode === 'smart') {
          resolvedById.set(node.id, derivedScore)
        } else {
          resolvedById.set(node.id, derivedScore !== null ? derivedScore : (modelScoreById.get(node.id) ?? null))
        }
      }
      const scoreOf = (nodeId: string, fallback: number | null): number | null =>
        resolvedById.has(nodeId) ? (resolvedById.get(nodeId) ?? null) : fallback
      const matches: OutlineMatch[] = [
        // 模型提到的节点（目录外的由 buildSkeleton 记进拒绝记录）。
        ...data.matches.map((match) => ({
          nodeId: match.nodeId,
          matchScore: scoreOf(match.nodeId, match.matchScore),
        })),
        // 模型没提到的目录节点：只有出处能给它打分。
        ...outline.nodes
          .filter((node) => !modelScoreById.has(node.id))
          .map((node) => ({ nodeId: node.id, matchScore: scoreOf(node.id, null) })),
      ]
      const skeleton = buildSkeleton(outline, matches, unitIdsByNodeId)
      const normalized = validateConceptMap({
        concepts: data.concepts,
        edges: data.edges,
      })
      const lessons = built.lessons
      const glossary = glossaryOf(normalized.conceptMap)
      const violations = [
        ...skeleton.violations,
        ...normalized.violations,
        ...built.violations,
        ...scaleViolations,
      ]
      return {
        outline,
        unitIdsByNodeId,
        skeleton: skeleton.skeleton,
        conceptMap: normalized.conceptMap,
        glossary,
        lessons,
        violations,
        runId,
        draftedText,
        draftedOutline,
      }
    }

    // 智能规划：自检不通过不呈现给教师——带失败原因自动重规划，≤3 次后转人工。
    const maxAttempts = mode === 'smart' ? MAX_PLAN_ATTEMPTS : 1
    let feedback: string | null = teacherFeedback
    let attempt: DraftAttempt | null = null
    let round = 0

    for (round = 1; round <= maxAttempts; round += 1) {
      const result = await draftOnce(feedback)
      if (mode !== 'smart') {
        attempt = result
        break
      }
      const issues: PlanCheckIssueView[] =
        result === null
          ? [
              {
                code: 'outline_empty',
                subject: '课程目录',
                message: 'Agent 没有产出任何目录条目',
              },
            ]
          : checkPlanDraft({
              nodes: result.outline.nodes,
              unitIdsByNodeId: result.unitIdsByNodeId,
              lessons: result.lessons,
              knownUnitIds,
              budget,
            })
      if (issues.length === 0) {
        attempt = result
        break
      }
      await repo.insertReview({
        courseId,
        planId: draft?.id ?? null,
        status: 'fail',
        attempts: round,
        issues,
      })
      if (round === maxAttempts) {
        await repo.insertReview({
          courseId,
          planId: draft?.id ?? null,
          status: 'manual',
          attempts: round,
          issues,
        })
        await jobs.failJob({
          jobId: job.id,
          code: 'plan_self_check_failed',
          message: `规划自检连续 ${round} 次未通过，已转人工处理：${issues
            .slice(0, 3)
            .map((issue) => issue.message)
            .join('；')}`,
          retryable: false,
        })
        return
      }
      feedback = `上一版规划自检未通过，请逐条修正后重新规划：\n${formatCheckIssues(issues)}`
    }

    if (!attempt) {
      await jobs.failJob({
        jobId: job.id,
        code: 'outline_draft_empty',
        message: 'Agent 未能拟出课程目录，请补充课程目标或素材后重新提交',
        retryable: false,
      })
      return
    }

    // 草案行：reject 占位行已存在则覆盖内容；首次起草由 worker 补建占位行。
    const target =
      draft ??
      (await repo.insertPlan({
        id: newId('plan'),
        courseId,
        version: await repo.nextPlanVersion(courseId),
        status: 'draft',
        origin: 'initial',
        createdBy: course.owner_id,
        skeleton: { nodes: [] },
        conceptMap: { concepts: [], edges: [] },
        glossary: { items: [] },
        sectionPlan: { lessons: [] },
        violations: [],
        aiRunId: null,
      }))
    await repo.updatePlanContent(target.id, {
      skeleton: attempt.skeleton,
      conceptMap: attempt.conceptMap,
      glossary: attempt.glossary,
      sectionPlan: { lessons: attempt.lessons },
      violations: attempt.violations,
      aiRunId: attempt.runId,
    })
    // 目录落库放在自检通过之后：坏目录不留痕。
    if (attempt.draftedOutline) {
      if (mode === 'smart') {
        // 智能规划只换工作目录树，教师原文（outline_text）留得住。
        await repo.updateCourseOutline(courseId, attempt.outline)
      } else {
        await repo.updateCoursePlanInput(courseId, {
          goal,
          outlineText: attempt.draftedText,
          outline: attempt.outline,
        })
      }
    }
    if (mode === 'smart') {
      await repo.insertReview({
        courseId,
        planId: target.id,
        status: 'pass',
        attempts: round,
        issues: [],
      })
    }

    await jobs.completeJob(job.id, 'drafted')
  } catch (err) {
    const retryable = err instanceof LlmError ? err.retryable : false
    const code = err instanceof LlmError ? err.code : 'draft_failed'
    await jobs.failJob({ jobId: job.id, code, message: (err as Error).message, retryable })
  }
}
