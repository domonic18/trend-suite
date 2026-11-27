import { z } from 'zod/v4'
import { GENERATORS } from './widget-data'
import { type WidgetType } from './widget-types'

/**
 * 断言词表与参数形状（arch/06 §8）：**唯一真相源**。
 *
 * 与 `widget-draft.ts`（v4）的关系：这里的参数形状直接进草稿契约，
 * 模型在 write_step_output 的工具 schema 里**看得见**每个断言要什么形状
 * （`cardCount` 是 `{min,max}`、`answerUnique` 是 `true`）——端到端实测踩过：
 * 形状只写在提示词散文里，模型看不见就把 `cardCount` 写成字符串
 * `"3-5"`，服务端复检必然拒绝（与图示 params 同一个病根）。
 *
 * 与 v3 `widgets.ts` 的关系：v3 spec 契约只把断言表当**自由键值对**存
 * （`assertions: z.object({}).passthrough()`），形状由服务端物化时用这份
 * 契约校验——故断言参数形状不需要在 v3 再写一遍（两份定义必然漂移）。
 *
 * 组件白名单放在 `widget-types.ts`（版本中立纯数据），本模块与 v3 契约
 * 都从那里取名单，避免 v3/v4 互相 import 成环。
 */

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

/**
 * 断言参数表：键 = 断言名，值 = 参数形状（arch/06 §8 参数列）。
 * 布尔型断言写 true；带参断言写对象。未知断言名在此被拒（strict）。
 */
export const assertionParams = z.strictObject({
  trendlineTouches: z.strictObject({ min: z.number().int().min(0) }).optional(),
  slopeRange: z.strictObject({ min: z.number(), max: z.number() }).optional(),
  noBreakBelow: z.literal(true).optional(),
  answerUnique: z.literal(true).optional(),
  distractorsDistinct: z.literal(true).optional(),
  patternMatchesAnswer: z.enum(GENERATORS).optional(),
  markersInRange: z.literal(true).optional(),
  conclusionsNonEmpty: z.literal(true).optional(),
  examplesRecomputable: z.literal(true).optional(),
  paramsInBounds: z.literal(true).optional(),
  termsInConcepts: z.literal(true).optional(),
  cardCount: z.strictObject({ min: z.number().int().min(0), max: z.number().int().min(0) }).optional(),
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
export type AssertionParams = z.infer<typeof assertionParams>

/** 断言名 → 参数形状（取单条时用）。 */
export function assertionParamShape(name: string): z.ZodType | null {
  const shapes = assertionParams.shape as Record<string, z.ZodType | undefined>
  return shapes[name] ?? null
}

/** 某组件适用的断言名（由「断言 → 适用组件」表反推）。 */
export function applicableAssertions(type: WidgetType): AssertionName[] {
  return (Object.entries(ASSERTION_TYPES) as [AssertionName, readonly WidgetType[]][])
    .filter(([, types]) => types.includes(type))
    .map(([name]) => name)
}

/**
 * 某组件的断言表形状：只含该组件适用的断言，键的参数形状照上表。
 * 草稿契约用它——模型看得见「这一类课件能声明哪些断言、各要什么形状」。
 */
export function assertionsForType(type: WidgetType): z.ZodType {
  const shape: Record<string, z.ZodType> = {}
  for (const name of applicableAssertions(type)) {
    const param = assertionParamShape(name)
    if (param) shape[name] = param.optional()
  }
  return z.strictObject(shape)
}
