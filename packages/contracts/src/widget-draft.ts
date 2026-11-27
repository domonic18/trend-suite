import { z } from 'zod/v4'
import {
  CALC_FORMULAS,
  GENERATORS,
  GENERATOR_BARS_MAX,
  GENERATOR_BARS_MIN,
  GENERATOR_SEED_MAX,
} from './widget-data'
import { assertionsForType } from './widget-assertions'
import type { WidgetType } from './widget-types'

/**
 * 课件**草稿**契约（arch/06 §9，zod/v4 子路径）：生产 agent 交给 write_step_output 的形状。
 *
 * 与 `widgets.ts` 的 v3 spec 的关系：**草稿 = spec 去掉 bars**——
 * 铁律「图表数值不由模型生成」，K 线一律由服务端按 generator+seed 合成，
 * 所以草稿里根本没有 bars 这个位置（模型写了也过不了这里的形状关）。
 * 草稿的字段名必须与 v3 spec 逐字一致，服务端物化时做**逐字段显式映射**
 * （编译期就能发现改名漂移），并有一份 fixture 同时过 v4 草稿与 v3 spec 的交叉测试。
 *
 * 用 zod/v4 而非 v3：agent 工具 schema 要喂给 langchain（SP1 结论，v3 实例不被接受）。
 *
 * **断言参数形状也在 schema 里**（`assertionsForType`，形状定义在
 * `widget-assertions.ts`）：模型看得见 `cardCount` 要 `{min,max}`、`answerUnique`
 * 是 `true`，不会把 cardCount 写成字符串 `"3-5"`（端到端实测踩过：形状只写在
 * 提示词散文里，模型看不见就乱填，服务端复检必然拒绝）。断言参数形状的
 * 唯一真相源是 `widget-assertions.ts`，本文件不重复定义。
 */

const text = z.string().min(1).max(2000)
const label = z.string().min(1).max(200)
/** 清单条目：上限 200 字（与 v3 spec 同口径）。 */
const itemText = z.string().min(1).max(200)
const generatorSeed = z.number().int().min(0).max(GENERATOR_SEED_MAX - 1)
const annotationKind = z.enum(['structure', 'invalidation', 'rhythm'])
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** 生成器声明：形态 + 种子 + 根数（**不含 K 线数值**，数值由生成器复算）。 */
const generatorData = z.strictObject({
  generator: z.enum(GENERATORS),
  seed: generatorSeed,
  bars: z.number().int().min(GENERATOR_BARS_MIN).max(GENERATOR_BARS_MAX),
})

/**
 * 断言表：按组件类型给形状——模型看得见这一类课件能声明哪些断言、各要什么形状。
 * （形状定义在 widget-assertions.ts，唯一真相源。）
 */
function assertionsOf(type: WidgetType): z.ZodType {
  return assertionsForType(type)
}

/** 包络：11 类共用（arch/06 §9）。 */
const draftEnvelope = {
  specVersion: z.number().int().min(1).optional(),
  citations: z.array(z.string().regex(/^su_[0-9a-f]{16}$/)).min(1),
}

export const widgetDraft = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('kline-annotator'),
    ...draftEnvelope,
    assertions: assertionsOf('kline-annotator'),
    data: generatorData,
    task: text,
    solution: z.strictObject({
      trendline: z.strictObject({
        startIdx: z.number().int().min(0),
        endIdx: z.number().int().min(0),
      }),
    }),
    annotations: z
      .array(z.strictObject({ idx: z.number().int().min(0), label, kind: annotationKind.optional() }))
      .optional(),
  }),
  z.strictObject({
    type: z.literal('pattern-quiz'),
    ...draftEnvelope,
    assertions: assertionsOf('pattern-quiz'),
    data: generatorData,
    question: text,
    options: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(40),
          label,
          generator: z.enum(GENERATORS).optional(),
          seed: generatorSeed.optional(),
          bars: z.number().int().min(GENERATOR_BARS_MIN).max(GENERATOR_BARS_MAX).optional(),
        }),
      )
      .min(2)
      .max(4),
    answerId: z.string().min(1).max(40),
  }),
  z.strictObject({
    type: z.literal('mcq-quiz'),
    ...draftEnvelope,
    assertions: assertionsOf('mcq-quiz'),
    question: text,
    options: z.array(z.strictObject({ id: z.string().min(1).max(40), label })).min(2).max(4),
    answerId: z.string().min(1).max(40),
    conceptRefs: z.array(text).min(1),
  }),
  z.strictObject({
    type: z.literal('step-reveal'),
    ...draftEnvelope,
    assertions: assertionsOf('step-reveal'),
    data: generatorData,
    steps: z
      .array(
        z.strictObject({
          title: label,
          fromIdx: z.number().int().min(0),
          toIdx: z.number().int().min(0),
          markers: z
            .array(
              z.strictObject({
                idx: z.number().int().min(0),
                price: z.number(),
                label: label.optional(),
              }),
            )
            .optional(),
          conclusion: text,
        }),
      )
      .min(2)
      .max(6),
    finalConclusion: text,
  }),
  z.strictObject({
    type: z.literal('calc-trainer'),
    ...draftEnvelope,
    assertions: assertionsOf('calc-trainer'),
    formula: z.enum(CALC_FORMULAS),
    inputs: z.record(z.string(), z.number()),
    examples: z
      .array(z.strictObject({ inputs: z.record(z.string(), z.number()), answer: z.number() }))
      .min(1)
      .max(10),
    tolerance: z.number().positive().optional(),
  }),
  z.strictObject({
    type: z.literal('flashcards'),
    ...draftEnvelope,
    assertions: assertionsOf('flashcards'),
    cards: z.array(z.strictObject({ front: text, back: text, conceptRef: text })).min(3).max(20),
  }),
  z.strictObject({
    type: z.literal('checklist'),
    ...draftEnvelope,
    assertions: assertionsOf('checklist'),
    title: text,
    items: z.array(z.strictObject({ text: itemText, conceptRef: text.optional() })).min(3).max(10),
  }),
  z.strictObject({
    type: z.literal('timeline-explorer'),
    ...draftEnvelope,
    assertions: assertionsOf('timeline-explorer'),
    nodes: z.array(z.strictObject({ conceptRef: text })).min(1),
    edges: z
      .array(
        z.strictObject({
          from: text,
          to: text,
          kind: z.enum(['prerequisite', 'related']),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    type: z.literal('image-juxtaposition'),
    ...draftEnvelope,
    assertions: assertionsOf('image-juxtaposition'),
    left: z.union([z.strictObject({ figureId: z.string().regex(/^fig_[0-9a-f]{16}$/) }), generatorData]),
    right: z.union([z.strictObject({ figureId: z.string().regex(/^fig_[0-9a-f]{16}$/) }), generatorData]),
    labels: z.strictObject({ left: label, right: label }),
    captions: z.strictObject({ left: text, right: text }),
  }),
  z.strictObject({
    type: z.literal('branching-scenario'),
    ...draftEnvelope,
    assertions: assertionsOf('branching-scenario'),
    scenario: text,
    nodes: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(40),
          prompt: text,
          options: z
            .array(
              z.strictObject({
                label: text,
                next: z.string().min(1).max(40).nullable(),
                feedback: text,
              }),
            )
            .min(1)
            .max(4),
        }),
      )
      .min(2),
    entryId: z.string().min(1).max(40),
    optimalPath: z.array(z.string().min(1).max(40)).min(1),
  }),
  z.strictObject({
    type: z.literal('bar-replay-decision'),
    ...draftEnvelope,
    assertions: assertionsOf('bar-replay-decision'),
    code: z.string().regex(/^\d{6}$/),
    window: z.strictObject({ from: isoDate, to: isoDate }),
    period: z.enum(['1d', '1w']).optional(),
    overlays: z.array(z.strictObject({ atDate: isoDate, label })).optional(),
    annotations: z
      .array(
        z.strictObject({
          unitId: z.string().regex(/^su_[0-9a-f]{16}$/),
          atMs: z.number().int().min(0),
          kind: annotationKind,
          d: isoDate,
          label,
        }),
      )
      .min(1),
    decisions: z
      .array(
        z.strictObject({
          atDate: isoDate,
          question: text,
          options: z.array(z.strictObject({ label: text })).min(2).max(4),
          correct: text,
          revealText: text,
          unitId: z.string().regex(/^su_[0-9a-f]{16}$/),
          atMs: z.number().int().min(0),
        }),
      )
      .min(1),
  }),
])
export type WidgetDraft = z.infer<typeof widgetDraft>

/** 步骤产物：课件草稿数组（步骤 5 回放、步骤 7 其余）。 */
export const widgetDraftList = z.object({
  widgets: z.array(widgetDraft).min(1).max(6),
})
export type WidgetDraftList = z.infer<typeof widgetDraftList>
