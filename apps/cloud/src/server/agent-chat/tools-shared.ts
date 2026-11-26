import 'server-only'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { insertMessage, type AgentThreadRow } from './repo'

/**
 * 两个 phase 共用的工具（arch/08 §4 白名单）：
 * ask_question（确认卡）与 todo_write（任务清单）——schema 与行为此前在
 * tools-plan / tools-production 里逐字重复，此处单一真相，phase 只留差异工具。
 */

/** 工具错误包装：把异常转成 `ERROR:…` 文本交还模型，不炸整轮。 */
export type ToolGuard = (fn: () => Promise<string>) => Promise<string>

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

/** 确认卡工具：问题 + 2~4 个选项 + 一句说明；调用后本轮结束等教师点选。 */
export function askQuestionTool(thread: AgentThreadRow, guard: ToolGuard) {
  return new DynamicStructuredTool({
    name: 'ask_question',
    description:
      '向教师发起确认卡提问（问题 + 2~4 个选项 + 一句说明）。调用后本轮结束、等待教师点选，不要再调用其它工具。',
    schema: askSchema as never,
    func: async (input: { text: string; options: { label: string; description?: string }[] }) =>
      guard(async () => {
        await insertMessage(thread.id, 'question', {
          source: 'agent',
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
}

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

/** 任务清单工具：始终展示线程内最新一份。 */
export function todoWriteTool(thread: AgentThreadRow, guard: ToolGuard) {
  return new DynamicStructuredTool({
    name: 'todo_write',
    description: '更新任务清单卡（会展示在对话里，始终显示最新一份）。动手前列出计划，做完逐步勾掉。',
    schema: todoSchema as never,
    func: async (input: { items: { content: string; status: 'pending' | 'doing' | 'done' }[] }) =>
      guard(async () => {
        await insertMessage(thread.id, 'todo', { items: input.items })
        return 'TODO 已更新并展示给教师。'
      }),
  })
}
