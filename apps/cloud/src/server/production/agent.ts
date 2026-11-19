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
import { evidenceTools } from './evidence'
import { TrendChatModel } from './channel'

/**
 * 九步的 agent 执行面（arch/05 §6）：deepagents 子代理 + 我们的通道 + PG checkpointer。
 * 每步一次 agent 调用，模型把产物交给唯一工具 write_step_output
 * （工具 schema 即第一层校验，zod/v4 实例，与 contracts 的 zod v3 互不干扰）。
 * thread_id = courseId/sectionId/sN：agent 侧崩溃由 checkpointer 续跑同一步（SP3）；
 * 权威状态仍在 production_tasks，checkpointer 只是运行态缓存。
 * 图示（步骤 4）与正文（步骤 6）是真实产物（迭代 6）：只读证据工具「先查再动笔」。
 */

// agent 步的产物形状。键 = steps.ts 的 def.key。
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

// 步骤 4 图示三路（arch/05 §8）：keyframe 必带 unitId（证据锚）、diagram 走模板白名单、
// generated 只给提示词（装饰图，禁止承载教学信息）。云端复检（persistFigures）还有
// 第二层确定性校验与配额把关，schema 先把住形状关。
const figureSpecProduct = (): z.ZodType =>
  z.object({
    figures: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('keyframe'),
            caption: z.string().min(1).max(80),
            unitId: z.string().regex(/^su_[0-9a-f]{16}$/),
            secHint: z.number().int().min(0).optional(),
          }),
          z.object({
            kind: z.literal('diagram'),
            caption: z.string().min(1).max(80),
            unitId: z.string().regex(/^su_[0-9a-f]{16}$/).optional(),
            template: z.enum(['chip-contrast', 'chip-horizontal', 'timeline', 'stat-inline']),
            params: z.record(z.string(), z.unknown()),
          }),
          z.object({
            kind: z.literal('generated'),
            caption: z.string().min(1).max(80),
            prompt: z.string().min(1).max(500),
          }),
        ]),
      )
      .min(1)
      .max(10),
  })

const widgetProduct = (): z.ZodType =>
  z.object({ widgets: z.array(z.object({ kind: z.string(), title: z.string() })) })

const STEP_PRODUCT_SCHEMAS: Record<string, z.ZodType> = {
  case_stocks: caseStockProduct(),
  figure_spec: figureSpecProduct(),
  replay_widget: widgetProduct(),
  section_draft: z.object({
    markdown: z.string().min(200).max(30_000),
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

export function sectionPrompt(def: StepDef, section: SectionRow, lastRejection?: string): string {
  const head = [
    `节上下文：course_id=${section.course_id}，section_id=${section.section_id}，标题「${section.title}」，序号 ${section.sort_order}。`,
  ]
  if (lastRejection) {
    head.push(
      '注意：上一轮产物被云端复检拒绝，原因如下。请先理解每一条拒绝原因并修正，再重新调用 write_step_output 写入完整产物。',
      `拒绝原因：${lastRejection}`,
    )
  }

  if (def.key === 'case_stocks') {
    // 迭代 5 真实工艺（arch/06 §5.1）：依据素材与节主题选出 2–4 只案例股。
    return [
      `课程生产第 ${def.n} 步「${def.label}」。请依据本节的素材要点与标题，选出 2–4 只最能支撑教学的 A 股案例股。`,
      ...head,
      `每只股票给出：6 位代码、名称、交易所（SH/SZ）、K 线周期（1d 日线或 1w 周线）、时间窗（windowStart/windowEnd，YYYY-MM-DD，起 ≤ 止；日线窗口不得早于 2024-03，更早请用 1w）、以及 ≤5 个落在窗口内的事件锚点（date + ≤30 字说明，如财报日、行业政策日）。`,
      `完成后调用 write_step_output 工具写入结果，然后用一句话确认完成。`,
    ].join('\n')
  }

  if (def.key === 'figure_spec') {
    // 迭代 6 真实工艺（arch/05 §8）：先查素材证据单元，再定三路图示。
    return [
      `课程生产第 ${def.n} 步「${def.label}」。为本节规划教学图示（keyframe 关键帧 / diagram 参数化图 / generated 装饰图）。`,
      ...head,
      `动笔前先用 search_source_units 检索与节主题相关的素材证据单元；术语可查 list_concepts，案例股可查 list_case_stocks。`,
      `三路的规矩：`,
      `- keyframe：讲师原始画面帧。必须带 unitId（来自 search_source_units 的 id，不可编造）与 caption；secHint 可选（该单元窗内的秒数，缺省取单元中点）。每节最多 6 张，宁缺毋滥，只选教学价值最高的画面。`,
      `- diagram：参数化 SVG 示意图。template 只能是 chip-contrast / chip-horizontal / timeline / stat-inline，params 必须符合对应模板约定（chip-contrast: title/leftLabel/rightLabel/leftCount 4-24/rightCount 4-24；chip-horizontal: title/priceLabel?/rows[{y 0-100, width 10-100, label?}] 2-12 行；timeline: title/events[{label,desc?}] 2-8 个；stat-inline: items[{label,value,note?}] 1-4 个）。每节最多 2 张。`,
      `- generated：纯装饰图（章节扉页/氛围图），只给 caption 与 prompt（画面描述）。禁止承载任何教学信息或具体数字。`,
      `把图示规格数组交给 write_step_output 工具写入（figures 字段），然后用一句话确认完成。`,
    ].join('\n')
  }

  if (def.key === 'section_draft') {
    // 迭代 6 真实工艺（arch/05 §8 / arch/06 §2）：DSL 成篇，五段结构，事实可回溯。
    return [
      `课程生产第 ${def.n} 步「${def.label}」。撰写本节教材正文：一篇读得下去的教学长文，1200~3000 字。`,
      ...head,
      `动笔前先用 search_source_units 检索本节可引的证据单元、list_concepts 查术语表、list_case_stocks 查案例股、list_figures 查本节已落库图示（上一「图示」步的产出，:::figure 只能引用其中的 figureId）。`,
      `正文结构五段固定，按序成篇：① 概念（本节讲什么，先立定义）→ ② 判断依据（怎么判、看什么信号）→ ③ 实例（用 [[stock:代码|名称]] 锚案例股讲透）→ ④ 检查清单（读者自测要点）→ ⑤ 常见误用（典型错误与纠正）。`,
      `DSL 规矩（v1）：`,
      `- 事实段必须带证据锚 [[unit:素材单元id|标签]]（id 来自 search_source_units，不可编造）——每一条可验证的陈述都要能回溯到录像位置。`,
      `- 容器块白名单 :::cards :::think :::sidenote :::warn :::board :::bignum :::cmp :::timeline :::figure :::clip；配额 think≤3、sidenote≤8、cards≤2、figure≤8、clip≤3。`,
      `- :::sidenote 是术语边注，title 必填且只能用 list_concepts 里的术语（原词）。`,
      `- :::figure figureId 只能引用 list_figures 返回的 id，caption 与图示步保持一致。`,
      `- :::clip 只能裁所引素材单元窗内的 60s 以内片段（assetId/from/to 秒/unitId 必填）。`,
      `- 禁用 v2 块（:::annotation / :::replay）。`,
      `把完整 markdown（含全部容器块与锚点）交给 write_step_output 工具写入（markdown 字段），然后用一句话确认完成。`,
    ].join('\n')
  }

  return [
    `课程生产第 ${def.n} 步「${def.label}」。当前为占位级产物阶段：不要长篇创作。`,
    ...head,
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

const EVIDENCE_STEP_KEYS = new Set(['figure_spec', 'section_draft'])

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
    tools: [
      buildStepTool(task),
      ...(EVIDENCE_STEP_KEYS.has(def.key) ? evidenceTools(task.course_id, task.section_id) : []),
    ],
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
  const prompt = sectionPrompt(def, section, task.last_error ?? undefined)
  await agent.invoke(
    { messages: [{ role: 'user', content: prompt }] },
    { configurable: { thread_id: `${task.course_id}/${task.section_id}/s${task.step}` } },
  )
  const checkpoint = await getTaskCheckpoint(task.id)
  if (!checkpoint || !(def.key in checkpoint)) {
    throw new Error(`模型未通过 write_step_output 写出第 ${def.n} 步产物`)
  }
}
