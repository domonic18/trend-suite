/**
 * 课件组件白名单（arch/06 §7）：唯一合法值，扩展需冻结新契约版本。
 *
 * **版本中立的纯数据**：11 类组件名被三处消费——v3 spec 契约（`widgets.ts`
 * 用 z.enum 包装）、v4 草稿契约（`widget-draft.ts`）、断言词表
 * （`widget-assertions.ts`）。把它单独放在不带 zod 的模块里，三处共用
 * 一份名单，又不会因 v3/v4 互相 import 而成环。
 */

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
