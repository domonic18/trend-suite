import 'server-only'
import {
  ASSERTION_NAMES,
  REQUIRED_ASSERTIONS,
  WIDGET_SPEC_VERSION,
  WIDGET_TYPES,
  applicableAssertions,
  assertionParamShape,
  classifyShape,
  generateBars,
  GENERATORS,
  GENERATOR_SEED_MAX,
  widgetDraft,
  widgetSpec,
  type AssertionName,
  type Generator,
  type WidgetIssue,
  type WidgetSpec,
  type WidgetType,
} from '@trend-suite/contracts'

/**
 * 课件草稿物化（arch/06 §9）：agent 的**语义草稿** → 可入库的完整 spec。
 *
 * 物化做三件事，且只做这三件（模型没写的数值一律不猜）：
 * 1. **补齐生成器参数**——干扰项未声明 generator/seed/bars 时按「形态互不相同」
 *    确定性补齐（seed 由选项 id 派生，同草稿必得同一结果，可重放）；
 * 2. **补齐必带断言的缺省参数**——必带断言缺了才补；声明了的断言原样保留
 *    （作者的选择，判不过即回灌）；未知断言名与不适用断言直接拒；
 * 3. **逐字段显式映射成 spec**——不做对象展开，字段改名会在编译期暴露
 *    （迭代 6 的教训：两边各写一套字段名，服务端判过、客户端渲染不出）。
 *
 * 铁律「图表数值不由模型生成」：spec 里**没有** K 线数值，只有生成参数，
 * 数值由服务端与渲染器按同一份实现复算（契约包 widget-data.ts）。
 */

export type MaterializeResult = {
  spec: WidgetSpec | null
  issues: WidgetIssue[]
}

/** 必带断言的缺省参数（作者未声明时补上；参数本身仍要证明成立）。 */
const DEFAULT_ASSERTION_PARAMS: Partial<Record<AssertionName, unknown>> = {
  trendlineTouches: { min: 2 },
  slopeRange: { min: 0, max: 90 },
  cardCount: { min: 3, max: 20 },
}

/** 确定性派生种子（FNV-1a）：同一选项 id 恒得同一 seed——重跑不漂移。 */
export function deriveSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % GENERATOR_SEED_MAX
}

function shapeOf(generator: Generator, seed: number, count: number): string {
  return classifyShape(generateBars(generator, seed, count))
}

/**
 * 补齐 pattern-quiz 的选项参数：未声明 generator 的按「形态互不相同」选一个
 * （形态按 bars 归类判定，与声明值无关）；已声明的是作者的选择，不改。
 */
function fillQuizOptions(
  data: { generator: Generator; seed: number; bars: number },
  answerId: string,
  options: {
    id: string
    generator?: Generator | undefined
    seed?: number | undefined
    bars?: number | undefined
  }[],
): { id: string; generator: Generator; seed: number; bars: number }[] {
  const used = new Set<string>()
  // 先占住正确项的形态，其余选项不得撞上。
  const answer = options.find((option) => option.id === answerId)
  const answerGenerator = answer?.generator ?? data.generator
  const answerSeed = answer?.seed ?? data.seed
  const answerBars = answer?.bars ?? data.bars
  used.add(shapeOf(answerGenerator, answerSeed, answerBars))

  return options.map((option) => {
    const count = option.bars ?? data.bars
    if (option.generator) {
      const seed = option.seed ?? deriveSeed(`${option.id}:${option.generator}`)
      return { id: option.id, generator: option.generator, seed, bars: count }
    }
    // 正确项钉在题目声明的形态上：它的形态必须等于 data 的形态
    // （distractorsDistinct 拿正确项与声明比对，钉不住必判不过）。
    if (option.id === answerId) {
      return { id: option.id, generator: answerGenerator, seed: answerSeed, bars: answerBars }
    }
    let picked: { generator: Generator; seed: number } | null = null
    for (const generator of GENERATORS) {
      const seed = deriveSeed(`${option.id}:${generator}`)
      if (!used.has(shapeOf(generator, seed, count))) {
        picked = { generator, seed }
        break
      }
    }
    if (!picked) {
      // 生成器用尽（形态重复）：退到第一个生成器，断言会在证明阶段判不过。
      picked = { generator: GENERATORS[0], seed: deriveSeed(`${option.id}:${GENERATORS[0]}`) }
    }
    used.add(shapeOf(picked.generator, picked.seed, count))
    return { id: option.id, generator: picked.generator, seed: picked.seed, bars: count }
  })
}

/** 对比侧：图示 id 或生成器参数（数值仍不入 spec）。 */
function materializeSide(
  side: { figureId: string } | { generator: Generator; seed: number; bars: number },
): { figureId: string } | { generator: Generator; seed: number; bars: number } {
  if ('figureId' in side) return { figureId: side.figureId }
  return { generator: side.generator, seed: side.seed, bars: side.bars }
}

/**
 * 断言表整理：未知名 / 不适用 / 参数形状不合 → 问题清单；缺必带断言 → 补缺省参数。
 *
 * 参数形状取自契约（widget-assertions.ts，v4）——模型看得见的形状与这里
 * 复检用的形状是同一份，模型填错这里必判不过（不会各判各的）。
 */
function normalizeAssertions(
  type: string,
  declared: Record<string, unknown>,
  applicable: readonly string[],
): { assertions: Record<string, unknown>; issues: WidgetIssue[] } {
  const issues: WidgetIssue[] = []
  const assertions: Record<string, unknown> = {}

  for (const [name, params] of Object.entries(declared)) {
    const known = (ASSERTION_NAMES as readonly string[]).includes(name)
    if (!known) {
      issues.push({ code: 'widget_spec_invalid', message: `未知断言名 ${name}`, assertion: name })
      continue
    }
    if (!applicable.includes(name)) {
      issues.push({
        code: 'assertion_not_applicable',
        message: `断言 ${name} 不适用于 ${type}`,
        assertion: name,
      })
      continue
    }
    const shape = assertionParamShape(name)
    if (!shape) {
      issues.push({ code: 'widget_spec_invalid', message: `未知断言名 ${name}`, assertion: name })
      continue
    }
    const parsed = shape.safeParse(params)
    if (!parsed.success) {
      issues.push({
        code: 'widget_spec_invalid',
        message: `断言 ${name} 的参数形状不合约定：${parsed.error.issues[0]?.message ?? ''}`,
        assertion: name,
      })
      continue
    }
    assertions[name] = parsed.data
  }

  for (const name of REQUIRED_ASSERTIONS[type as keyof typeof REQUIRED_ASSERTIONS] ?? []) {
    if (!(name in assertions)) {
      assertions[name] = DEFAULT_ASSERTION_PARAMS[name] ?? true
    }
  }
  return { assertions, issues }
}

/**
 * 物化一份草稿 → spec（问题清单非空即 spec 为 null，绝不半成品）。
 *
 * 断言表**先**复检：逐条给精确问题（哪个断言、形状怎么不合），
 * 比整份草稿一次报「形状不合」好定位得多；断言过了再走整份草稿的形状关。
 */
export function materializeWidget(draft: unknown): MaterializeResult {
  const raw = draft && typeof draft === 'object' ? (draft as Record<string, unknown>) : {}
  const rawType = typeof raw.type === 'string' ? raw.type : ''
  let assertions: Record<string, unknown> = {}
  if ((WIDGET_TYPES as readonly string[]).includes(rawType)) {
    const declared =
      raw.assertions && typeof raw.assertions === 'object' && !Array.isArray(raw.assertions)
        ? (raw.assertions as Record<string, unknown>)
        : {}
    const normalized = normalizeAssertions(
      rawType,
      declared,
      applicableAssertions(rawType as WidgetType),
    )
    if (normalized.issues.length > 0) return { spec: null, issues: normalized.issues }
    assertions = normalized.assertions
  }

  const parsed = widgetDraft.safeParse(draft)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      spec: null,
      issues: [
        {
          code: 'widget_spec_invalid',
          message: `课件草稿形状不合约定：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
        },
      ],
    }
  }
  const value = parsed.data

  const base = {
    specVersion: WIDGET_SPEC_VERSION,
    citations: value.citations,
    assertions,
  }

  let candidate: unknown
  switch (value.type) {
    case 'kline-annotator':
      candidate = {
        ...base,
        type: value.type,
        data: { generator: value.data.generator, seed: value.data.seed, bars: value.data.bars },
        task: value.task,
        solution: {
          trendline: {
            startIdx: value.solution.trendline.startIdx,
            endIdx: value.solution.trendline.endIdx,
          },
        },
        ...(value.annotations
          ? {
              annotations: value.annotations.map((annotation) => ({
                idx: annotation.idx,
                label: annotation.label,
                ...(annotation.kind ? { kind: annotation.kind } : {}),
              })),
            }
          : {}),
      }
      break
    case 'pattern-quiz': {
      const options = fillQuizOptions(value.data, value.answerId, value.options)
      candidate = {
        ...base,
        type: value.type,
        data: { generator: value.data.generator, seed: value.data.seed, bars: value.data.bars },
        question: value.question,
        options: options.map((option) => ({
          id: option.id,
          label: value.options.find((draftOption) => draftOption.id === option.id)?.label ?? option.id,
          generator: option.generator,
          seed: option.seed,
          bars: option.bars,
        })),
        answerId: value.answerId,
      }
      break
    }
    case 'mcq-quiz':
      candidate = {
        ...base,
        type: value.type,
        question: value.question,
        options: value.options.map((option) => ({ id: option.id, label: option.label })),
        answerId: value.answerId,
        conceptRefs: value.conceptRefs,
      }
      break
    case 'step-reveal':
      candidate = {
        ...base,
        type: value.type,
        data: { generator: value.data.generator, seed: value.data.seed, bars: value.data.bars },
        steps: value.steps.map((step) => ({
          title: step.title,
          fromIdx: step.fromIdx,
          toIdx: step.toIdx,
          ...(step.markers
            ? {
                markers: step.markers.map((marker) => ({
                  idx: marker.idx,
                  price: marker.price,
                  ...(marker.label ? { label: marker.label } : {}),
                })),
              }
            : {}),
          conclusion: step.conclusion,
        })),
        finalConclusion: value.finalConclusion,
      }
      break
    case 'calc-trainer':
      candidate = {
        ...base,
        type: value.type,
        formula: value.formula,
        inputs: { ...value.inputs },
        examples: value.examples.map((example) => ({
          inputs: { ...example.inputs },
          answer: example.answer,
        })),
        ...(value.tolerance !== undefined ? { tolerance: value.tolerance } : {}),
      }
      break
    case 'flashcards':
      candidate = {
        ...base,
        type: value.type,
        cards: value.cards.map((card) => ({
          front: card.front,
          back: card.back,
          conceptRef: card.conceptRef,
        })),
      }
      break
    case 'checklist':
      candidate = {
        ...base,
        type: value.type,
        title: value.title,
        items: value.items.map((item) => ({
          text: item.text,
          ...(item.conceptRef ? { conceptRef: item.conceptRef } : {}),
        })),
      }
      break
    case 'timeline-explorer':
      candidate = {
        ...base,
        type: value.type,
        nodes: value.nodes.map((node) => ({ conceptRef: node.conceptRef })),
        edges: value.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })),
      }
      break
    case 'image-juxtaposition':
      candidate = {
        ...base,
        type: value.type,
        left: materializeSide(value.left),
        right: materializeSide(value.right),
        labels: { left: value.labels.left, right: value.labels.right },
        captions: { left: value.captions.left, right: value.captions.right },
      }
      break
    case 'branching-scenario':
      candidate = {
        ...base,
        type: value.type,
        scenario: value.scenario,
        nodes: value.nodes.map((node) => ({
          id: node.id,
          prompt: node.prompt,
          options: node.options.map((option) => ({
            label: option.label,
            next: option.next,
            feedback: option.feedback,
          })),
        })),
        entryId: value.entryId,
        optimalPath: [...value.optimalPath],
      }
      break
    case 'bar-replay-decision':
      candidate = {
        ...base,
        type: value.type,
        code: value.code,
        window: { from: value.window.from, to: value.window.to },
        ...(value.period ? { period: value.period } : {}),
        ...(value.overlays
          ? { overlays: value.overlays.map((overlay) => ({ atDate: overlay.atDate, label: overlay.label })) }
          : {}),
        annotations: value.annotations.map((annotation) => ({
          unitId: annotation.unitId,
          atMs: annotation.atMs,
          kind: annotation.kind,
          d: annotation.d,
          label: annotation.label,
        })),
        decisions: value.decisions.map((decision) => ({
          atDate: decision.atDate,
          question: decision.question,
          options: decision.options.map((option) => ({ label: option.label })),
          correct: decision.correct,
          revealText: decision.revealText,
          unitId: decision.unitId,
          atMs: decision.atMs,
        })),
      }
      break
  }

  const spec = widgetSpec.safeParse(candidate)
  if (!spec.success) {
    const first = spec.error.issues[0]
    return {
      spec: null,
      issues: [
        {
          code: 'widget_spec_invalid',
          message: `课件 spec 不合契约：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
        },
      ],
    }
  }
  return { spec: spec.data, issues: [] }
}
