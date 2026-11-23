import 'server-only'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { tweakPlanRequest } from '@trend-suite/contracts'
import { enqueueJob, findJobByCourse } from '@/server/pipeline/jobs/repo'
import {
  CURRICULUM_JOB_KIND,
  rejectPlanInternal,
  tweakPlanInternal,
} from '@/server/content/plans/service'
import * as plansRepo from '@/server/content/plans/repo'
import { insertMessage, type AgentThreadRow } from './repo'

/**
 * 方案阶段的工具白名单（arch/08 §4）：get_plan / draft_plan / revise_plan /
 * apply_tweak / ask_question / todo_write。明确不在白名单：approve_plan——
 * 批准只由服务端答案处理器按教师所选选项确定性执行，模型没有对应工具（红线）。
 *
 * 所有工具都在线程授权语境下运行（sendMessage/answer 时已校验属主与角色），
 * 因此底层复用 plans service 的 internal 变体，不再重复权限校验。
 */

function text(args: unknown): string {
  return JSON.stringify(args)
}

/** 把 HttpError 转成模型可读的工具错误文本，避免一次失败炸掉整轮 run。 */
async function guard(fn: () => Promise<string>): Promise<string> {
  try {
    return await fn()
  } catch (err) {
    const message = (err as Error).message ?? '工具执行失败'
    return `ERROR:${message}`
  }
}

type PlanNode = { id: string; title: string; level: number; matchStatus?: string }
type PlanLesson = { id: string; title: string; subLessonCount?: number; estimatedMinutes?: number }
type PlanViolation = { kind?: string; message?: string; resolved?: boolean; nodeId?: string }

export function planTools(thread: AgentThreadRow) {
  const courseId = thread.course_id

  const getPlan = new DynamicStructuredTool({
    name: 'get_plan',
    description: '读取课程当前方案：目录树、骨架匹配度、课时、术语、违规项与状态。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        const draft = await plansRepo.findDraftPlan(courseId)
        const approved = await plansRepo.findApprovedPlan(courseId)
        const row = draft ?? approved
        if (!row) {
          const input = await plansRepo.findCoursePlanInput(courseId)
          return text({
            status: 'none',
            goal: input?.goal ?? null,
            hasOutline: Boolean(input?.outline),
            hint: '没有方案。教师提交目标与目录后可用 draft_plan 起草。',
          })
        }
        const skeleton = (row.skeleton as { nodes?: PlanNode[] } | null)?.nodes ?? []
        const lessons = ((row.section_plan as { lessons?: PlanLesson[] } | null)?.lessons ?? []) as PlanLesson[]
        const glossary = (row.glossary as { terms?: unknown[] } | null)?.terms ?? []
        const violations = ((row.violations ?? []) as PlanViolation[]) ?? []
        const unresolved = violations.filter((v) => !v.resolved)
        const input = await plansRepo.findCoursePlanInput(courseId)
        return text({
          status: row.status,
          version: row.version,
          goal: input?.goal ?? null,
          outline: input?.outline ?? null,
          skeletonNodes: skeleton.map((node) => ({
            id: node.id,
            title: node.title,
            level: node.level,
            matchStatus: node.matchStatus ?? 'ok',
          })),
          lessons: lessons.map((lesson) => ({
            id: lesson.id,
            title: lesson.title,
            subLessonCount: lesson.subLessonCount ?? 1,
            estimatedMinutes: lesson.estimatedMinutes ?? null,
          })),
          glossaryCount: Array.isArray(glossary) ? glossary.length : 0,
          violations: violations.map((v) => ({
            nodeId: v.nodeId ?? null,
            message: v.message ?? v.kind ?? '',
            resolved: Boolean(v.resolved),
          })),
          approvalReady:
            row.status === 'draft' &&
            skeleton.every((node) => node.matchStatus !== 'low_match') &&
            unresolved.length === 0,
        })
      }),
  })

  const draftPlan = new DynamicStructuredTool({
    name: 'draft_plan',
    description: '提交方案起草任务（素材理解 → 生成方案草案）。起草完成后系统会在对话里通知。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        const input = await plansRepo.findCoursePlanInput(courseId)
        if (!input?.goal) {
          return 'ERROR:课程目标还没提交——请教师在右栏先提交课程目标与目录，再触发起草。'
        }
        const inflight = await findJobByCourse({ courseId, kind: CURRICULUM_JOB_KIND })
        if (inflight && (inflight.status === 'queued' || inflight.status === 'running')) {
          return '起草任务已在进行中，完成后会在对话里通知，无需重复提交。'
        }
        await enqueueJob({ courseId, kind: CURRICULUM_JOB_KIND })
        return '已提交起草任务。完成后系统会在对话里通知，期间教师可以在右栏查看素材与目录。'
      }),
  })

  const revisePlan = new DynamicStructuredTool({
    name: 'revise_plan',
    description: '带着教师意见打回当前草案并重新起草（旧草案作废，生成新版本）。',
    schema: z.object({ feedback: z.string().min(1).max(2000).describe('教师的修订意见') }) as never,
    func: async (input: { feedback: string }) =>
      guard(async () => {
        const view = await rejectPlanInternal(courseId, input.feedback, thread.created_by)
        return `已按意见打回并重新起草（新版本 v${view.version}）。完成后会在对话里通知。`
      }),
  })

  const applyTweak = new DynamicStructuredTool({
    name: 'apply_tweak',
    description:
      '对方案做结构化微调，右栏即时生效。op 取值：rename_chapter(nodeId,title) / merge_chapters(nodeIds,title) / remove_chapter(nodeId) / add_chapter(parentId,title) / move_node(nodeId,newParentId,position) / reorder_lessons(lessonIds) / set_granularity(lessonId,subLessonCount) / add_alias(conceptId,alias)。nodeId/lessonId/conceptId 必须来自 get_plan 返回的真实 id。',
    schema: z.object({ op: z.record(z.string(), z.unknown()).describe('微调操作对象，见描述里的 8 个操作') }) as never,
    func: async (input: { op: Record<string, unknown> }) =>
      guard(async () => {
        const parsed = tweakPlanRequest.safeParse(input.op)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          return `ERROR:微调参数不合法（${issue?.path.join('.') ?? ''}: ${issue?.message ?? '形状不对'}）。请按 8 个操作的形状重试。`
        }
        const view = await tweakPlanInternal(courseId, parsed.data, thread.created_by)
        return `微调已生效（当前版本 v${view.version}），教师右栏已同步。`
      }),
  })

  const askSchema = z.object({
    text: z.string().min(1).max(500).describe('问题正文'),
    options: z
      .array(
        z.object({
          label: z.string().min(1).max(60).describe('选项标签'),
          description: z.string().max(300).optional().describe('一句说明，可省略'),
        }),
      )
      .min(2)
      .max(4)
      .describe('选项列表'),
  })
  const askQuestion = new DynamicStructuredTool({
    name: 'ask_question',
    description:
      '向教师发起确认卡提问（问题 + 2~4 个选项 + 一句说明）。调用后本轮结束、等待教师点选，不要再调用其它工具。',
    schema: askSchema as never,
    func: async (input: { text: string; options: { label: string; description?: string }[] }) =>
      guard(async () => {
        await insertMessage(thread.id, 'question', {
          question: {
            text: input.text,
            options: input.options.map((option) => ({
              label: option.label,
              description: option.description ?? null,
            })),
            answeredIndex: null,
          },
        })
        return '已向教师发出确认卡。本轮到此为止，等待教师回答。'
      }),
  })

  const todoSchema = z.object({
    items: z
      .array(
        z.object({
          content: z.string().min(1).max(200).describe('任务内容'),
          status: z.enum(['pending', 'doing', 'done']).describe('状态'),
        }),
      )
      .min(1)
      .max(12),
  })
  const todoWrite = new DynamicStructuredTool({
    name: 'todo_write',
    description: '更新任务清单卡（会展示在对话里，始终显示最新一份）。开工前列出计划，做完逐步勾掉。',
    schema: todoSchema as never,
    func: async (input: { items: { content: string; status: 'pending' | 'doing' | 'done' }[] }) =>
      guard(async () => {
        await insertMessage(thread.id, 'todo', { items: input.items })
        return 'TODO 已更新并展示给教师。'
      }),
  })

  return [getPlan, draftPlan, revisePlan, applyTweak, askQuestion, todoWrite]
}
