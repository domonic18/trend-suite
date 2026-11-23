import 'server-only'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import {
  getProductionBoardInternal,
  resumeProductionInternal,
  retryProductionSectionInternal,
  stopProductionInternal,
} from '@/server/production/service'
import { insertMessage, type AgentThreadRow } from './repo'

/**
 * 制作阶段的工具白名单（arch/08 §4）：get_production_status / stop_production /
 * resume_production / retry_section / ask_question / todo_write。
 * 「批准方案」等确认类动作不在本阶段也不在任何白名单（红线）。
 *
 * 所有工具都在线程授权语境下运行（sendMessage/answer 时已校验属主与角色），
 * 因此底层复用 production service 的 internal 变体，不再重复权限校验。
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

type BoardTask = { step: number; label: string; status: string; attempts: number; lastError: string | null }
type BoardSection = {
  sectionId: string
  title: string
  status: string
  products: number
  tasks: BoardTask[]
}

export function productionTools(thread: AgentThreadRow) {
  const courseId = thread.course_id

  const getStatus = new DynamicStructuredTool({
    name: 'get_production_status',
    description:
      '读取九步生产看板：每节的状态与 9 步进度（含失败原因）、制作 job 状态、当前停止点。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        const board = await getProductionBoardInternal(courseId)
        return text({
          job: board.job
            ? { status: board.job.status, error: board.job.errorMessage ?? board.job.errorCode }
            : null,
          stopped: board.stop
            ? {
                sectionTitle: board.stop.sectionTitle,
                step: board.stop.step,
                stepLabel: board.stop.stepLabel,
              }
            : null,
          sections: board.sections.map(
            (section: BoardSection): Record<string, unknown> => ({
              sectionId: section.sectionId,
              title: section.title,
              status: section.status,
              doneSteps: section.products,
              problems: section.tasks
                .filter((task) => task.status === 'pending_manual' || task.status === 'failed')
                .map((task) => ({ step: task.step, label: task.label, error: task.lastError })),
            }),
          ),
          hint:
            board.sections.some((s) =>
              s.tasks.some((t) => t.status === 'pending_manual' || t.status === 'failed'),
            )
              ? '有节挂起，可用 retry_section 重试（需要 sectionId）。'
              : undefined,
        })
      }),
  })

  const stopProduction = new DynamicStructuredTool({
    name: 'stop_production',
    description:
      '停止制作：当前步跑完即在步边界安全停下，已完成的步成果保留、回灌预算保留，改完可继续。仅在教师明确要停时调用。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        const stop = await stopProductionInternal(courseId)
        return stop.step
          ? `已下达停止：${stop.sectionTitle ?? ''}第 ${stop.step} 步「${stop.stepLabel ?? ''}」跑完就停，成果保留。`
          : '已下达停止：任务还在排队，尚未开跑就已停止。'
      }),
  })

  const resumeProduction = new DynamicStructuredTool({
    name: 'resume_production',
    description: '继续制作：从停下的地方接着跑，已完成的步不重跑。仅在制作处于已停止状态时调用。',
    schema: z.object({}) as never,
    func: async () =>
      guard(async () => {
        await resumeProductionInternal(courseId)
        return '已继续制作：任务重新入队，从停下的地方接着跑，已完成的步不重跑。'
      }),
  })

  const retrySection = new DynamicStructuredTool({
    name: 'retry_section',
    description:
      '重试挂起或失败的节：清零回灌预算回到 pending 并重新入队。sectionId 必须来自 get_production_status。',
    schema: z.object({ sectionId: z.string().min(1).describe('节 id（来自 get_production_status）') }) as never,
    func: async (input: { sectionId: string }) =>
      guard(async () => {
        await retryProductionSectionInternal(courseId, input.sectionId)
        return '已重试该节：回灌预算清零、任务重新入队，完成后会在对话里留痕。'
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
    description: '更新任务清单卡（会展示在对话里，始终显示最新一份）。动手前列出计划，做完逐步勾掉。',
    schema: todoSchema as never,
    func: async (input: { items: { content: string; status: 'pending' | 'doing' | 'done' }[] }) =>
      guard(async () => {
        await insertMessage(thread.id, 'todo', { items: input.items })
        return 'TODO 已更新并展示给教师。'
      }),
  })

  return [getStatus, stopProduction, resumeProduction, retrySection, askQuestion, todoWrite]
}
