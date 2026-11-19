import { z } from 'zod/v4'
import {
  CALC_FORMULAS,
  GENERATORS,
  GENERATOR_BARS_MAX,
  GENERATOR_BARS_MIN,
  GENERATOR_SEED_MAX,
} from './widget-data.js'

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
 * 参数形状不在这里重复定义——断言参数的唯一真相源是 v3 的 `assertionParams`，
 * 由物化阶段（服务端）按契约校验，草稿只做「键名已知」的粗筛。
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

/** 断言参数表：键名粗筛（白名单内的名字），值的形状由 v3 契约校验。 */
const assertionMap = z.record(z.string(), z.unknown())

/** 包络：11 类共用（arch/06 §9）。 */
const draftEnvelope = {
  specVersion: z.number().int().min(1).optional(),
  citations: z.array(z.string().regex(/^su_[0-9a-f]{16}$/)).min(1),
  assertions: assertionMap,
}

export const widgetDraft = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('kline-annotator'),
    ...draftEnvelope,
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
    question: text,
    options: z.array(z.strictObject({ id: z.string().min(1).max(40), label })).min(2).max(4),
    answerId: z.string().min(1).max(40),
    conceptRefs: z.array(text).min(1),
  }),
  z.strictObject({
    type: z.literal('step-reveal'),
    ...draftEnvelope,
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
    cards: z.array(z.strictObject({ front: text, back: text, conceptRef: text })).min(3).max(20),
  }),
  z.strictObject({
    type: z.literal('checklist'),
    ...draftEnvelope,
    title: text,
    items: z.array(z.strictObject({ text: itemText, conceptRef: text.optional() })).min(3).max(10),
  }),
  z.strictObject({
    type: z.literal('timeline-explorer'),
    ...draftEnvelope,
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
    left: z.union([z.strictObject({ figureId: z.string().regex(/^fig_[0-9a-f]{16}$/) }), generatorData]),
    right: z.union([z.strictObject({ figureId: z.string().regex(/^fig_[0-9a-f]{16}$/) }), generatorData]),
    labels: z.strictObject({ left: label, right: label }),
    captions: z.strictObject({ left: text, right: text }),
  }),
  z.strictObject({
    type: z.literal('branching-scenario'),
    ...draftEnvelope,
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
