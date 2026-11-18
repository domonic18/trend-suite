import 'server-only'
import { z } from 'zod'
import {
  buildOutlineFromSections,
  parseOutlineText,
  type CourseOutlineView,
  type OutlineNode,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { findCourseById } from '../repo'
import * as jobs from '@/server/pipeline/jobs/repo'
import type { PipelineJobRow } from '@/server/pipeline/jobs/repo'
import { runLlmJson, LlmError } from '../agents/llm'
import { buildSkeleton, parseStoredOutline, type OutlineMatch } from './outline'
import { validateConceptMap, glossaryOf, type RawConceptInput, type RawConceptEdgeInput } from './concepts'
import * as repo from './repo'
import type { PlanLesson } from './tweak'

/**
 * 方案起草 worker 入口（arch/05 §5 阶段三）：join 课程目标 + 人工目录 + 就绪素材
 * 转写语料 → LLM 产 JSON → 目录/概念校验 → 回写草案行。打回重起草不重跑素材理解，
 * 只追加教师意见。失败经 failJob 走队列退避（LlmError.retryable）。
 */

const CURRICULUM_TASK = 'content.curriculum'
const MAX_TOKENS = 16_000
/** 转写语料字符上限：超长课程按序截断（标记省略），避免单请求超上下文。 */
const CORPUS_MAX_CHARS = 48_000

const draftOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        nodeId: z.string(),
        matchScore: z.number().min(0).max(1).nullable(),
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
      }),
    )
    .default([]),
})

type DraftOutput = z.infer<typeof draftOutputSchema>

/** Agent 代拟目录的结构（篇=1 / 章=2 / 课时=3）。 */
const outlineDraftSchema = z.object({
  sections: z
    .array(
      z.object({
        level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        title: z.string().min(1),
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
  goal: string
  outlineNodes: { id: string; title: string }[]
  corpus: string
  feedback: string | null
}): { system: string; user: string } {
  const system = [
    '你是课程方案起草助手。根据课程目标、人工目录与素材转写语料，产出课程方案草案。',
    '规则：',
    '1. 严格目录先验：matches 只允许引用目录给出的 nodeId，不得发明目录外章节；目录中每个节点都要有匹配条目，无证据的节点 matchScore 用 null。',
    '2. matchScore 为 0～1 的证据匹配度，表示该章节有多少素材内容支撑。',
    '3. concepts 收录课程核心概念：name 唯一、definition 一句话；同义表述放 aliases。',
    '4. edges 按概念名引用（from/to 必须是 concepts 里的 name），kind 只能是 prerequisite（先修）或 related（相关）；不要制造循环先修。',
    '5. lessons 为分节计划：每条对应一个课时级章节（sectionId 引用目录 nodeId，无法对应时用 null），title 为课时标题，subLessonCount 1～20，estimatedMinutes 5～240，parallelSlot 1～8。',
    '只输出一个 JSON 对象，字段：matches、concepts、edges、lessons，不要输出任何其他文字。',
  ].join('\n')

  const outlineList = input.outlineNodes.map((node) => `${node.id}: ${node.title}`).join('\n')
  const user = [
    `## 课程目标\n${input.goal}`,
    `## 人工目录（id: 标题）\n${outlineList}`,
    input.feedback ? `## 上一版教师意见（本次起草须吸收）\n${input.feedback}` : null,
    `## 素材转写语料\n${input.corpus || '（无转写语料）'}`,
  ]
    .filter((section) => section !== null)
    .join('\n\n')
  return { system, user }
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

function normalizeLessons(
  lessons: DraftOutput['lessons'],
  knownSectionIds: Set<string>,
): { lessons: PlanLesson[]; violations: { kind: 'outline_violation'; subject: string; reason: string }[] } {
  const out: PlanLesson[] = []
  const violations: { kind: 'outline_violation'; subject: string; reason: string }[] = []
  lessons.forEach((lesson, index) => {
    let sectionId = lesson.sectionId
    if (sectionId && !knownSectionIds.has(sectionId)) {
      violations.push({
        kind: 'outline_violation',
        subject: sectionId,
        reason: `分节计划「${lesson.title.slice(0, 40)}」引用了目录外章节，已改为未挂载`,
      })
      sectionId = null
    }
    out.push({
      id: `l${index + 1}`,
      sectionId,
      title: lesson.title.slice(0, 200),
      subLessonCount: clamp(lesson.subLessonCount, 1, 20),
      estimatedMinutes: clamp(lesson.estimatedMinutes, 5, 240),
      parallelSlot: clamp(lesson.parallelSlot, 1, 8),
    })
  })
  return { lessons: out, violations }
}

/**
 * 目录先验（人工目录）缺失时的兜底：按已存的目录树取；目录树与文本都不可用
 * 则返回 null（由调用方决定代拟还是失败）。
 */
function resolveOutline(inputRow: repo.CoursePlanInputRow): CourseOutlineView | null {
  const stored = parseStoredOutline(inputRow.outline)
  if (stored) return stored
  const text = (inputRow.outline_text ?? '').trim()
  if (text.length === 0) return null
  const { nodes, issues } = parseOutlineText(text)
  return issues.length === 0 ? { nodes } : null
}

function buildOutlinePrompt(input: {
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
    '只输出一个 JSON 对象：{"sections":[{"level":1,"title":"..."}]}，不要输出任何其他文字。',
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

/** Agent 代拟目录 → 规范目录文本 + 目录树（文本与树同源，见 contracts outline.ts）。 */
async function draftOutline(input: {
  courseId: string
  goal: string
  corpus: string
  feedback: string | null
}): Promise<{ text: string; nodes: OutlineNode[] }> {
  const prompt = buildOutlinePrompt(input)
  const { data } = await runLlmJson({
    task: CURRICULUM_TASK,
    purpose: 'llm',
    refType: 'course',
    refId: input.courseId,
    system: prompt.system,
    user: prompt.user,
    maxTokens: OUTLINE_MAX_TOKENS,
    schema: outlineDraftSchema,
    summarize: (out) => `sections=${out.sections.length}`,
  })
  return buildOutlineFromSections(data.sections)
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

    await jobs.updateJobProgress({ jobId: job.id, step: 'corpus', progress: 10 })
    const lines = await repo.listTranscriptLines(courseId)
    const corpus = buildCorpus(lines)
    const draft = await repo.findDraftPlan(courseId)
    const feedback = draft?.origin === 'revision' ? draft.trigger_note : null

    // 目录先验：人工目录优先；教师留空则 Agent 代拟一版并回写（原型口径：目录可选）。
    let outline = resolveOutline(inputRow)
    if (!outline) {
      await jobs.updateJobProgress({ jobId: job.id, step: 'outlining', progress: 20 })
      const drafted = await draftOutline({
        courseId,
        goal: inputRow.goal,
        corpus,
        feedback,
      })
      if (drafted.nodes.length === 0) {
        await jobs.failJob({
          jobId: job.id,
          code: 'outline_draft_empty',
          message: 'Agent 未能拟出课程目录，请补充课程目标或素材后重新提交',
          retryable: false,
        })
        return
      }
      outline = { nodes: drafted.nodes }
      await repo.updateCoursePlanInput(courseId, {
        goal: inputRow.goal,
        outlineText: drafted.text,
        outline,
      })
    }

    await jobs.updateJobProgress({ jobId: job.id, step: 'drafting', progress: 30 })
    const prompt = buildPrompt({
      goal: inputRow.goal,
      outlineNodes: outline.nodes,
      corpus,
      feedback,
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
      summarize: (out) =>
        `nodes=${outline.nodes.length} matches=${out.matches.length} concepts=${out.concepts.length} edges=${out.edges.length} lessons=${out.lessons.length} corpusLines=${lines.length}`,
    })

    await jobs.updateJobProgress({ jobId: job.id, step: 'validating', progress: 70 })
    const matches: OutlineMatch[] = data.matches.map((match) => ({
      nodeId: match.nodeId,
      matchScore: match.matchScore,
    }))
    const skeleton = buildSkeleton(outline, matches)
    const conceptInput: { concepts: RawConceptInput[]; edges: RawConceptEdgeInput[] } = {
      concepts: data.concepts,
      edges: data.edges,
    }
    const normalized = validateConceptMap(conceptInput)
    const lessons = normalizeLessons(
      data.lessons,
      new Set(outline.nodes.map((node) => node.id)),
    )
    const glossary = glossaryOf(normalized.conceptMap)
    const violations = [...skeleton.violations, ...normalized.violations, ...lessons.violations]

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
      skeleton: skeleton.skeleton,
      conceptMap: normalized.conceptMap,
      glossary,
      sectionPlan: { lessons: lessons.lessons },
      violations,
      aiRunId: runId,
    })

    await jobs.completeJob(job.id, 'drafted')
  } catch (err) {
    const retryable = err instanceof LlmError ? err.retryable : false
    const code = err instanceof LlmError ? err.code : 'draft_failed'
    await jobs.failJob({ jobId: job.id, code, message: (err as Error).message, retryable })
  }
}
