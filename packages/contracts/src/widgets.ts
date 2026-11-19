import { z } from 'zod'
import { idShape } from './ids.js'
import { CALC_FORMULAS, GENERATORS, GENERATOR_BARS_MAX, GENERATOR_BARS_MIN, GENERATOR_SEED_MAX } from './widget-data.js'

/**
 * 交互课件契约（arch/06 §7–§9）：11 类组件白名单 + 25 条断言词表 +
 * spec 包络。冻结契约——扩组件类型或改破坏性字段必须升 specVersion
 * 并同步渲染器。
 *
 * 铁律三条在此落成结构：课件是 spec（数据）不是代码；图表数值不由模型生成
 * （bars 由服务端按 generator+seed 合成，见 widget-data.ts）；断言必带且必被
 * 程序证明（证明器在 apps/cloud/src/server/content/widgets/assertions.ts）。
 */

export const WIDGET_SPEC_VERSION = 1

/** 组件白名单（arch/06 §7）：唯一合法值，扩展需冻结新契约版本。 */
export const WIDGET_TYPES = [
  'kline-annotator',
  'pattern-quiz',
  'mcq-quiz',
  'step-reveal',
  'calc-trainer',
  'flashcards',
  'checklist',
  'timeline-explorer',
  'image-juxtaposition',
  'branching-scenario',
  'bar-replay-decision',
] as const
export type WidgetType = (typeof WIDGET_TYPES)[number]
export const widgetType = z.enum(WIDGET_TYPES)

/** 断言词表（arch/06 §8）：键 = 断言名，值 = 适用组件。 */
export const ASSERTION_TYPES = {
  trendlineTouches: ['kline-annotator'],
  slopeRange: ['kline-annotator'],
  noBreakBelow: ['kline-annotator'],
  answerUnique: ['pattern-quiz', 'mcq-quiz', 'bar-replay-decision'],
  distractorsDistinct: ['pattern-quiz'],
  patternMatchesAnswer: ['pattern-quiz'],
  markersInRange: ['step-reveal'],
  conclusionsNonEmpty: ['step-reveal'],
  examplesRecomputable: ['calc-trainer'],
  paramsInBounds: ['calc-trainer'],
  termsInConcepts: ['mcq-quiz', 'flashcards', 'checklist'],
  cardCount: ['flashcards'],
  itemsNonEmpty: ['checklist'],
  edgeRefsExist: ['timeline-explorer'],
  acyclicPrerequisite: ['timeline-explorer'],
  pairSidesValid: ['image-juxtaposition'],
  captionsGrounded: ['image-juxtaposition'],
  graphAcyclic: ['branching-scenario'],
  allPathsTerminate: ['branching-scenario'],
  optimalPathReachable: ['branching-scenario'],
  feedbackNonEmpty: ['branching-scenario'],
  decisionPointsGrounded: ['bar-replay-decision'],
  revealMonotonic: ['bar-replay-decision'],
  annotationTermsGrounded: ['bar-replay-decision'],
} as const satisfies Record<string, readonly WidgetType[]>

export const ASSERTION_NAMES = Object.keys(ASSERTION_TYPES) as readonly (keyof typeof ASSERTION_TYPES)[]
export type AssertionName = (typeof ASSERTION_NAMES)[number]

/** 每类组件的必带断言（arch/06 §9 表）；缺失即判不过。 */
export const REQUIRED_ASSERTIONS = {
  'kline-annotator': ['trendlineTouches', 'slopeRange', 'noBreakBelow'],
  'pattern-quiz': ['answerUnique', 'distractorsDistinct'],
  'mcq-quiz': ['answerUnique', 'termsInConcepts'],
  'step-reveal': ['markersInRange', 'conclusionsNonEmpty'],
  'calc-trainer': ['examplesRecomputable', 'paramsInBounds'],
  flashcards: ['termsInConcepts', 'cardCount'],
  checklist: ['itemsNonEmpty'],
  'timeline-explorer': ['edgeRefsExist', 'acyclicPrerequisite'],
  'image-juxtaposition': ['pairSidesValid', 'captionsGrounded'],
  'branching-scenario': ['graphAcyclic', 'allPathsTerminate', 'optimalPathReachable', 'feedbackNonEmpty'],
  'bar-replay-decision': ['answerUnique', 'decisionPointsGrounded', 'revealMonotonic', 'annotationTermsGrounded'],
} as const satisfies Record<WidgetType, readonly AssertionName[]>

// ---------------------------------------------------------------- 通用片段

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const text = z.string().min(1).max(2000)
const label = z.string().min(1).max(200)
/** 清单条目：上限 200 字（断言 itemsNonEmpty 的判据，契约与断言同口径）。 */
const itemText = z.string().min(1).max(200)
const generatorSeed = z.number().int().min(0).max(GENERATOR_SEED_MAX - 1)
/** K 线根数（生成器参数域 20–120）。 */
const generatorBars = z.number().int().min(GENERATOR_BARS_MIN).max(GENERATOR_BARS_MAX)

/**
 * 生成器数据块：generator + seed + bars（**根数**，不是 K 线数组）。
 * 铁律「图表数值不由模型生成」：spec 只存生成参数，数值由服务端与渲染器
 * 各自按 (generator, seed, bars) 用**同一份**实现复算（契约包 widget-data.ts），
 * 故 spec 不落数值、可重放、跨端逐字节一致。
 */
const generatorData = z
  .object({
    generator: z.enum(GENERATORS),
    seed: generatorSeed,
    bars: generatorBars,
  })
  .strict()

/** spec 包络（arch/06 §9）：版本 + 引用 + 断言，11 类共用。 */
const specEnvelope = {
  specVersion: z.number().int().min(1),
  /** 证据引用：必须指向存在的 source unit（arch/06 §8「citations ≥1」）。 */
  citations: z.array(z.string().regex(idShape.sourceUnit)).min(1),
  assertions: z.object({}).passthrough(),
}

// ---------------------------------------------------------------- 断言参数

/**
 * 断言参数表：键 = 断言名，值 = 参数形状（arch/06 §8 参数列）。
 * 布尔型断言写 true；带参断言写对象。未知断言名在此被拒（.strict()）。
 */
export const assertionParams = z
  .object({
    trendlineTouches: z.object({ min: z.number().int().min(0) }).strict().optional(),
    slopeRange: z.object({ min: z.number(), max: z.number() }).strict().optional(),
    noBreakBelow: z.literal(true).optional(),
    answerUnique: z.literal(true).optional(),
    distractorsDistinct: z.literal(true).optional(),
    patternMatchesAnswer: z.enum(GENERATORS).optional(),
    markersInRange: z.literal(true).optional(),
    conclusionsNonEmpty: z.literal(true).optional(),
    examplesRecomputable: z.literal(true).optional(),
    paramsInBounds: z.literal(true).optional(),
    termsInConcepts: z.literal(true).optional(),
    cardCount: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }).strict().optional(),
    itemsNonEmpty: z.literal(true).optional(),
    edgeRefsExist: z.literal(true).optional(),
    acyclicPrerequisite: z.literal(true).optional(),
    pairSidesValid: z.literal(true).optional(),
    captionsGrounded: z.literal(true).optional(),
    graphAcyclic: z.literal(true).optional(),
    allPathsTerminate: z.literal(true).optional(),
    optimalPathReachable: z.literal(true).optional(),
    feedbackNonEmpty: z.literal(true).optional(),
    decisionPointsGrounded: z.literal(true).optional(),
    revealMonotonic: z.literal(true).optional(),
    annotationTermsGrounded: z.literal(true).optional(),
  })
  .strict()
export type AssertionParams = z.infer<typeof assertionParams>

// ---------------------------------------------------------------- 11 类 spec

const klineAnnotatorSpec = z
  .object({
    type: z.literal('kline-annotator'),
    ...specEnvelope,
    data: generatorData,
    task: text,
    solution: z
      .object({
        trendline: z
          .object({ startIdx: z.number().int().min(0), endIdx: z.number().int().min(0) })
          .strict(),
      })
      .strict(),
    annotations: z
      .array(
        z
          .object({
            idx: z.number().int().min(0),
            label,
            kind: z.enum(['structure', 'invalidation', 'rhythm']).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()

const patternQuizSpec = z
  .object({
    type: z.literal('pattern-quiz'),
    ...specEnvelope,
    /** 正确项的图表生成参数（数值由生成器复算，spec 不落 K 线）。 */
    data: generatorData,
    question: text,
    options: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            label,
            /** 未声明时由服务端按「形态互不相同」补齐；声明了就是作者的选择（判不过即回灌）。 */
            generator: z.enum(GENERATORS).optional(),
            seed: generatorSeed.optional(),
            bars: generatorBars.optional(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    answerId: z.string().min(1).max(40),
  })
  .strict()

const mcqQuizSpec = z
  .object({
    type: z.literal('mcq-quiz'),
    ...specEnvelope,
    question: text,
    options: z
      .array(z.object({ id: z.string().min(1).max(40), label }).strict())
      .min(2)
      .max(4),
    answerId: z.string().min(1).max(40),
    conceptRefs: z.array(text).min(1),
  })
  .strict()

const stepRevealSpec = z
  .object({
    type: z.literal('step-reveal'),
    ...specEnvelope,
    data: generatorData,
    steps: z
      .array(
        z
          .object({
            title: label,
            fromIdx: z.number().int().min(0),
            toIdx: z.number().int().min(0),
            markers: z
              .array(
                z
                  .object({ idx: z.number().int().min(0), price: z.number(), label: label.optional() })
                  .strict(),
              )
              .optional(),
            conclusion: text,
          })
          .strict(),
      )
      .min(2)
      .max(6),
    finalConclusion: text,
  })
  .strict()

const calcTrainerSpec = z
  .object({
    type: z.literal('calc-trainer'),
    ...specEnvelope,
    formula: z.enum(CALC_FORMULAS),
    inputs: z.record(z.string(), z.number()),
    examples: z
      .array(
        z.object({ inputs: z.record(z.string(), z.number()), answer: z.number() }).strict(),
      )
      .min(1)
      .max(10),
    /** 相对容差（默认 1e-6）。 */
    tolerance: z.number().positive().optional(),
  })
  .strict()

const flashcardsSpec = z
  .object({
    type: z.literal('flashcards'),
    ...specEnvelope,
    cards: z
      .array(z.object({ front: text, back: text, conceptRef: text }).strict())
      .min(3)
      .max(20),
  })
  .strict()

const checklistSpec = z
  .object({
    type: z.literal('checklist'),
    ...specEnvelope,
    title: text,
    items: z.array(z.object({ text: itemText, conceptRef: text.optional() }).strict()).min(3).max(10),
  })
  .strict()

const timelineExplorerSpec = z
  .object({
    type: z.literal('timeline-explorer'),
    ...specEnvelope,
    nodes: z.array(z.object({ conceptRef: text }).strict()).min(1),
    edges: z
      .array(
        z.object({ from: text, to: text, kind: z.enum(['prerequisite', 'related']) }).strict(),
      )
      .min(1),
  })
  .strict()

const juxtaposeSide = z.union([
  z.object({ figureId: z.string().regex(idShape.figure) }).strict(),
  generatorData,
])

const imageJuxtapositionSpec = z
  .object({
    type: z.literal('image-juxtaposition'),
    ...specEnvelope,
    left: juxtaposeSide,
    right: juxtaposeSide,
    labels: z.object({ left: label, right: label }).strict(),
    captions: z.object({ left: text, right: text }).strict(),
  })
  .strict()

const branchingScenarioSpec = z
  .object({
    type: z.literal('branching-scenario'),
    ...specEnvelope,
    scenario: text,
    nodes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            prompt: text,
            options: z
              .array(
                z
                  .object({ label: text, next: z.string().min(1).max(40).nullable(), feedback: text })
                  .strict(),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(2),
    entryId: z.string().min(1).max(40),
    optimalPath: z.array(z.string().min(1).max(40)).min(1),
  })
  .strict()

const barReplayDecisionSpec = z
  .object({
    type: z.literal('bar-replay-decision'),
    ...specEnvelope,
    /** 案例股代码——正文 :::replay 按此定位课件（arch/06 §2.2）。 */
    code: z.string().regex(/^\d{6}$/),
    window: z.object({ from: isoDate, to: isoDate }).strict(),
    period: z.enum(['1d', '1w']).optional(),
    overlays: z.array(z.object({ atDate: isoDate, label }).strict()).optional(),
    annotations: z
      .array(
        z
          .object({
            unitId: z.string().regex(idShape.sourceUnit),
            atMs: z.number().int().min(0),
            kind: z.enum(['structure', 'invalidation', 'rhythm']),
            d: isoDate,
            label,
          })
          .strict(),
      )
      .min(1),
    decisions: z
      .array(
        z
          .object({
            atDate: isoDate,
            question: text,
            options: z.array(z.object({ label: text }).strict()).min(2).max(4),
            /** 正确选项的文案（options 只有 label，没有 id）。 */
            correct: text,
            revealText: text,
            unitId: z.string().regex(idShape.sourceUnit),
            atMs: z.number().int().min(0),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

/** 11 类 spec 的判别联合（按 type 判别）。 */
export const widgetSpec = z.discriminatedUnion('type', [
  klineAnnotatorSpec,
  patternQuizSpec,
  mcqQuizSpec,
  stepRevealSpec,
  calcTrainerSpec,
  flashcardsSpec,
  checklistSpec,
  timelineExplorerSpec,
  imageJuxtapositionSpec,
  branchingScenarioSpec,
  barReplayDecisionSpec,
])
export type WidgetSpec = z.infer<typeof widgetSpec>

/** 必带断言缺哪些（空数组 = 齐了）。 */
export function missingRequiredAssertions(spec: { type: WidgetType; assertions: Record<string, unknown> }): string[] {
  return REQUIRED_ASSERTIONS[spec.type].filter((name) => !(name in spec.assertions))
}

// ---------------------------------------------------------------- 校验问题与视图

export const widgetErrorCode = z.enum([
  'widget_spec_invalid',
  'assertion_missing',
  'assertion_not_applicable',
  'assertion_unproven',
  'citation_unknown',
  'generator_invalid',
])
export type WidgetErrorCode = z.infer<typeof widgetErrorCode>

export const widgetIssue = z.object({
  code: widgetErrorCode,
  message: z.string().min(1),
  /** 失败断言名（断言类问题必带）。 */
  assertion: z.string().optional(),
  /** 可据以改写的具体数字/依据。 */
  detail: z.string().optional(),
})
export type WidgetIssue = z.infer<typeof widgetIssue>

export const widgetAssertionView = z.object({
  name: z.string().min(1),
  status: z.enum(['pass', 'fail']),
  detail: z.string(),
})
export type WidgetAssertionView = z.infer<typeof widgetAssertionView>

/** 课件视图（管理台预览 / 学员端共用）。 */
export const widgetView = z.object({
  id: z.string().regex(idShape.widget),
  /** 课程内大纲展示号（如 '1-1'）。 */
  sectionId: z.string().min(1),
  type: widgetType,
  /** 仅 bar-replay-decision 非空（正文 :::replay 按 code 定位）。 */
  code: z.string().nullable(),
  specVersion: z.number().int().min(1),
  /** 内容版本：覆盖写时递增（widgetId 不变，arch/06 §12）。 */
  version: z.number().int().min(1),
  spec: widgetSpec,
  /** 断言证明记录（arch/06 §11：只记程序证明，不记学员作答）。 */
  assertions: z.array(widgetAssertionView),
  citations: z.array(z.string()),
})
export type WidgetView = z.infer<typeof widgetView>

export const widgetListResponse = z.object({ widgets: z.array(widgetView) })
export type WidgetListResponse = z.infer<typeof widgetListResponse>
