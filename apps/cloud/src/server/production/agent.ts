import 'server-only'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { createDeepAgent } from 'deepagents'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { FetchLike } from '@/server/content/agents/llm'
import { getEnv } from '@/env'
import {
  getTaskCheckpoint,
  saveStepOutput,
  type ProductionTaskRow,
  type SectionRow,
} from './repo'
import { stepDef, type StepDef } from './steps'
import { TrendChatModel } from './channel'

/**
 * 九步的 agent 执行面（arch/05 §6）：deepagents 子代理 + 我们的通道 + PG checkpointer。
 * 每步一次 agent 调用，模型把产物交给唯一工具 write_step_output
 * （工具 schema 即第一层校验，zod/v4 实例，与 contracts 的 zod v3 互不干扰）。
 * thread_id = courseId/sectionId/sN：agent 侧崩溃由 checkpointer 续跑同一步（SP3）；
 * 权威状态仍在 production_tasks，checkpointer 只是运行态缓存。
 */

// agent 步的产物形状。case_stocks 为真实产物（迭代 5，arch/06 §5.1）：
// 云端复检还会做确定性二次校验与自动归一，schema 先把住格式关。键 = steps.ts 的 def.key。
const caseStockProduct = (): z.ZodType =>
  z.object({
    stocks: z
      .array(
        z.object({
          code: z.string().regex(/^\d{6}$/),
          name: z.string().min(1).max(20),
          exchange: z.enum(['SH', 'SZ']),
          period: z.enum(['1d', '1w']),
          windowStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          windowEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          events: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1).max(30) })).max(5),
        }),
      )
      .min(2)
      .max(4),
  })
const widgetProduct = (): z.ZodType =>
  z.object({ widgets: z.array(z.object({ kind: z.string(), title: z.string() })) })
const STEP_PRODUCT_SCHEMAS: Record<string, z.ZodType> = {
  case_stocks: caseStockProduct(),
  figure_spec: z.object({
    figures: z.array(z.object({ title: z.string(), kind: z.string() })),
  }),
  replay_widget: widgetProduct(),
  section_draft: z.object({
    paragraphs: z.array(z.string()),
  }),
  widgets: widgetProduct(),
  review: z.object({
    verdict: z.enum(['pass', 'needs_work']),
    notes: z.string(),
  }),
}

function productSchema(step: number): z.ZodType {
  const schema = STEP_PRODUCT_SCHEMAS[stepDef(step).key]
  if (!schema) throw new Error(`步骤 ${step} 没有占位产物 schema`)
  return schema
}

// ---------------------------------------------------------------- PG checkpointer（进程内单例）

let saverPromise: Promise<PostgresSaver> | null = null

export function getCheckpointer(): Promise<PostgresSaver> {
  if (!saverPromise) {
    saverPromise = (async () => {
      const saver = PostgresSaver.fromConnString(getEnv().DATABASE_URL)
      await saver.setup()
      return saver
    })()
  }
  return saverPromise
}

// ---------------------------------------------------------------- 步 agent

export function sectionPrompt(def: StepDef, section: SectionRow): string {
  if (def.key === 'case_stocks') {
    // 迭代 5 真实工艺（arch/06 §5.1）：依据素材与节主题选出 2–4 只案例股。
    return [
      `课程生产第 ${def.n} 步「${def.label}」。请依据本节的素材要点与标题，选出 2–4 只最能支撑教学的 A 股案例股。`,
      `节上下文：course_id=${section.course_id}，section_id=${section.section_id}，标题「${section.title}」，序号 ${section.sort_order}。`,
      `每只股票给出：6 位代码、名称、交易所（SH/SZ）、K 线周期（1d 日线或 1w 周线）、时间窗（windowStart/windowEnd，YYYY-MM-DD，起 ≤ 止；日线窗口不得早于 2024-03，更早请用 1w）、以及 ≤5 个落在窗口内的事件锚点（date + ≤30 字说明，如财报日、行业政策日）。`,
      `完成后调用 write_step_output 工具写入结果，然后用一句话确认完成。`,
    ].join('\n')
  }
  return [
    `课程生产第 ${def.n} 步「${def.label}」。当前为占位级产物阶段：不要长篇创作。`,
    `节上下文：course_id=${section.course_id}，section_id=${section.section_id}，标题「${section.title}」，序号 ${section.sort_order}。`,
    `请调用 write_step_output 工具写入一个符合工具参数结构的最小占位 JSON，然后用一句话确认完成。`,
  ].join('\n')
}

export function buildStepTool(task: ProductionTaskRow): DynamicStructuredTool {
  const def = stepDef(task.step)
  // rawSchema 是我们自己的 zod/v4 实例（第一层校验用它）；DynamicStructuredTool
  // 只认方法调用（parse/safeParse），不同 zod 实例间靠鸭子类型兼容（SP1 结论）。
  const rawSchema = z.object({ product: productSchema(task.step) })
  return new DynamicStructuredTool({
    name: 'write_step_output',
    description: '写入本步骤的产物（唯一出口）',
    schema: rawSchema as never,
    func: async (input: { product?: unknown }) => {
      await saveStepOutput(task.id, def.key, input.product)
      return 'ok'
    },
  })
}

export async function buildStepAgent(fields: {
  task: ProductionTaskRow
  section: SectionRow
  /** 测试注入：透传给通道替换 fetch。 */
  fetchImpl?: FetchLike
}) {
  const { task, section } = fields
  const def = stepDef(task.step)
  if (!def.taskKey) throw new Error(`第 ${def.n} 步不是 agent 步`)
  const model = new TrendChatModel({
    task: def.taskKey,
    purpose: 'llm',
    refType: 'production_task',
    refId: task.id,
    ...(fields.fetchImpl ? { fetchImpl: fields.fetchImpl } : {}),
  })
  return createDeepAgent({
    model,
    tools: [buildStepTool(task)],
    checkpointer: await getCheckpointer(),
    systemPrompt: sectionPrompt(def, section),
  })
}

/** 执行一步 agent 调用；模型没把产物交给工具时抛错走回灌。 */
export async function runStepAgent(fields: {
  task: ProductionTaskRow
  section: SectionRow
}): Promise<void> {
  const { task, section } = fields
  const def = stepDef(task.step)
  const agent = await buildStepAgent({ task, section })
  await agent.invoke(
    { messages: [{ role: 'user', content: sectionPrompt(def, section) }] },
    { configurable: { thread_id: `${task.course_id}/${task.section_id}/s${task.step}` } },
  )
  const checkpoint = await getTaskCheckpoint(task.id)
  if (!checkpoint || !(def.key in checkpoint)) {
    throw new Error(`模型未通过 write_step_output 写出第 ${def.n} 步产物`)
  }
}
