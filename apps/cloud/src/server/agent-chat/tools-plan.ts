import 'server-only'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { tweakPlanRequest } from '@trend-suite/contracts'
import { findJobByCourse } from '@/server/pipeline/jobs/repo'
import { listAssetsByCourse } from '@/server/pipeline/repo'
import { listUnitCountsByAssets } from '@/server/pipeline/processing/repo'
import {
  CURRICULUM_JOB_KIND,
  rejectPlanInternal,
  savePlanInputInternal,
  tweakPlanInternal,
} from '@/server/content/plans/service'
import * as plansRepo from '@/server/content/plans/repo'
import { insertMessage, type AgentThreadRow } from './repo'

/**
 * 方案阶段的工具白名单（arch/08 §4）：get_plan / get_materials / draft_plan /
 * revise_plan / apply_tweak / ask_question / todo_write。明确不在白名单：
 * approve_plan——批准只由服务端答案处理器按教师所选选项确定性执行，模型没有
 * 对应工具（红线）。
 *
 * 起草的交互口径（主流 AskQuestion）：目标与目录由教师在对话里给出（自由文本），
 * 规划方式等结构化选择由模型用 ask_question 确认卡提问、教师点选；收集齐后
 * draft_plan 带参落库并触发起草（内部走 savePlanInputInternal，门禁全保留）。
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

  const getMaterials = new DynamicStructuredTool({
    name: 'get_materials',
    description:
      '列出课程可选的素材（id、文件名、就绪状态、要点数）。教师要求只用部分素材起草时，用它把素材名对应到 assetIds。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        const assets = await listAssetsByCourse(courseId)
        const counts = new Map(
          (await listUnitCountsByAssets(assets.map((asset) => asset.id))).map((row) => [row.asset_id, row]),
        )
        return text(
          assets.map((asset) => ({
            id: asset.id,
            fileName: asset.original_name ?? '素材',
            status: asset.status,
            durationS: asset.duration_s === null ? null : Number(asset.duration_s),
            pointCount: counts.get(asset.id)?.point_count ?? 0,
          })),
        )
      }),
  })

  const draftPlanSchema = z.object({
    goal: z.string().min(1).max(2000).optional().describe('课程目标（教师原话，来自对话）'),
    outlineText: z.string().max(20000).optional().describe('人工目录原文（可留空由 Agent 代拟）'),
    mode: z.enum(['smart', 'follow_manual']).optional().describe('规划方式：智能重新规划目录 / 沿用人工目录骨架'),
    assetIds: z.array(z.string().min(1)).optional().describe('参与规划的素材 id（缺省 = 全部素材）'),
  })
  const draftPlan = new DynamicStructuredTool({
    name: 'draft_plan',
    description:
      '落库起草输入并提交方案起草任务（素材理解 → 生成方案草案）。起草前先把对话里收集到的 goal / outlineText / mode / assetIds 原样带上——没问过的字段不要编；未提供的字段沿用课程已保存的值。目标从未提交过时先在对话里收集。',
    schema: draftPlanSchema as never,
    func: async (input: { goal?: string; outlineText?: string; mode?: 'smart' | 'follow_manual'; assetIds?: string[] }) =>
      guard(async () => {
        const inflight = await findJobByCourse({ courseId, kind: CURRICULUM_JOB_KIND })
        if (inflight && (inflight.status === 'queued' || inflight.status === 'running')) {
          return '起草任务已在进行中，完成后会在对话里通知，无需重复提交。'
        }
        const existing = await plansRepo.findCoursePlanInput(courseId)
        const goal = input.goal ?? existing?.goal ?? ''
        if (!goal.trim()) {
          return 'ERROR:课程目标还没拿到——先在对话里向教师收集目标（可用确认卡问规划方式），再带参调用 draft_plan。'
        }
        await savePlanInputInternal(courseId, thread.created_by, {
          goal,
          outlineText: input.outlineText ?? existing?.outline_text ?? '',
          allowPartial: false,
          ...(input.mode != null ? { mode: input.mode } : {}),
          ...(input.assetIds != null ? { assetIds: input.assetIds } : {}),
        })
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

  return [getPlan, getMaterials, draftPlan, revisePlan, applyTweak, askQuestion, todoWrite]
}
