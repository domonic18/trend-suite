import {
  dslAnnotationBody,
  dslBignumBody,
  dslCardsBody,
  dslCmpBody,
  dslQuotas,
  dslTimelineBody,
  directiveAllowedInVersion,
  V2_DIRECTIVES,
  type DslAst,
  type DslIssue,
} from '@trend-suite/contracts'
import type { DslBlock } from '@trend-suite/contracts'

/**
 * 教材 DSL 第 2 层语义校验（arch/06 §2.4，随正文写入复检）：
 * 纯函数 + 依赖注入（图示集 / source units / 案例股清单 / 概念词表 /
 * 案例窗口与交易日 / 本节回放课件），产物 DslIssue[]（带行号；术语违例带词与
 * 最近似建议）——空数组即通过。JSON 块形状、配额、clip 窗口接地、术语表全词匹配
 * 都在这一层收口。
 */

export type ValidatorUnit = { assetId: string; startMs: number; endMs: number }

export type ValidatorDeps = {
  /** 本节已落库的图示 id 集（:::figure figureId 必须在其中）。 */
  figureIds: ReadonlySet<string>
  /** 本课程全部 source units（允许跨节引用）。 */
  units: ReadonlyMap<string, ValidatorUnit>
  /** 本节案例股 code 清单。 */
  stockCodes: ReadonlySet<string>
  /** 概念词表（name + aliases 原样，全词匹配）。 */
  terms: readonly string[]
  /** 案例股 code → 案例窗口（ISO 日期，arch/06 §5.1）。 */
  caseWindows: ReadonlyMap<string, { from: string; to: string }>
  /** 案例股 code → 真实交易日集合（quote_bars 读回，非交易日即拒）。 */
  tradingDays: ReadonlyMap<string, ReadonlySet<string>>
  /** 本节已落库的回放课件 code → 份数（0 = 无，>1 = 定位不唯一）。 */
  replayCodes: ReadonlyMap<string, number>
}

const TEXT_LIMITS: Record<string, number> = { think: 800, sidenote: 500, warn: 500, board: 500 }
const WARN_VARIANTS = new Set(['def', 'rule', 'misuse', 'risk'])
const ANNOTATION_KINDS = new Set(['structure', 'invalidation', 'rhythm'])
const CLIP_MAX_WINDOW_MS = 60_000

export function validateDsl(ast: DslAst, deps: ValidatorDeps): DslIssue[] {
  const issues: DslIssue[] = []
  const quotaCount = new Map<string, number>()

  for (const segment of ast.segments) {
    if (segment.type !== 'block') continue
    const block = segment.block

    if (!directiveAllowedInVersion(block.directive, ast.version)) {
      const isV2 = V2_DIRECTIVES.includes(block.directive as (typeof V2_DIRECTIVES)[number])
      issues.push({
        code: 'directive_not_in_version',
        line: block.line,
        message: isV2
          ? `:::${block.directive} 是 v2 溯源块，当前 dslVersion=${ast.version} 不启用`
          : `未知容器块 :::${block.directive}（白名单外）`,
      })
      continue
    }

    const quota = dslQuotas[block.directive as keyof typeof dslQuotas]
    if (quota !== undefined) {
      const count = (quotaCount.get(block.directive) ?? 0) + 1
      quotaCount.set(block.directive, count)
      if (count === quota + 1) {
        issues.push({
          code: `${block.directive}_quota_exceeded` as DslIssue['code'],
          line: block.line,
          message: `:::${block.directive} 超出每节配额（≤${quota}）`,
        })
      }
    }

    validateBlockBody(block, deps, issues)
  }

  for (const anchor of ast.anchors) {
    if (anchor.kind === 'unit' && !deps.units.has(anchor.ref)) {
      issues.push({
        code: 'unit_anchor_unknown',
        line: anchor.line,
        message: `证据锚 [[unit:${anchor.ref}|…]] 在本课程素材单元中不存在`,
      })
    }
    if (anchor.kind === 'stock' && !deps.stockCodes.has(anchor.ref)) {
      issues.push({
        code: 'stock_not_in_list',
        line: anchor.line,
        message: `个股锚 [[stock:${anchor.ref}|…]] 不在本节案例股清单内`,
      })
    }
  }

  return issues
}

function requireUnit(
  block: DslBlock,
  deps: ValidatorDeps,
  issues: DslIssue[],
): { assetId: string; startMs: number; endMs: number } | null {
  const unitId = block.attrs.unitId
  if (!unitId) {
    issues.push({ code: 'body_schema_failed', line: block.line, message: `:::${block.directive} 缺 unitId 属性` })
    return null
  }
  const unit = deps.units.get(unitId)
  if (!unit) {
    issues.push({
      code: 'unit_ref_unknown',
      line: block.line,
      message: `unitId=${unitId} 在本课程素材单元中不存在`,
    })
    return null
  }
  return unit
}

function validateBlockBody(block: DslBlock, deps: ValidatorDeps, issues: DslIssue[]): void {
  switch (block.directive) {
    case 'cards':
    case 'bignum':
    case 'cmp':
    case 'timeline':
      validateJsonBlock(block, issues)
      return
    case 'think': {
      const title = block.attrs.title ?? ''
      if (title.length < 1 || title.length > 50) {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::think title 必填且 1~50 字' })
      }
      checkTextLength(block, issues)
      return
    }
    case 'sidenote': {
      checkTextLength(block, issues)
      const title = (block.attrs.title ?? '').trim()
      if (title.length === 0) {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::sidenote 缺 title（术语边注必须声明术语）' })
        return
      }
      const match = findTerm(deps.terms, title)
      if (!match) {
        issues.push({
          code: 'term_not_in_concepts',
          line: block.line,
          term: title,
          suggestion: nearestTerm(deps.terms, title),
          message: `术语边注「${title}」不在课程概念表（name 与别名全词匹配）`,
        })
      }
      if (block.attrs.unitId) {
        requireUnit(block, deps, issues)
      }
      return
    }
    case 'warn': {
      const title = block.attrs.title ?? ''
      if (title.length < 1 || title.length > 50) {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::warn title 必填且 1~50 字' })
      }
      const variant = block.attrs.variant ?? 'risk'
      if (!WARN_VARIANTS.has(variant)) {
        issues.push({
          code: 'body_schema_failed',
          line: block.line,
          message: `:::warn variant=${variant} 不在四型变体内（def/rule/misuse/risk）`,
        })
      }
      checkTextLength(block, issues)
      return
    }
    case 'board':
      requireUnit(block, deps, issues)
      checkTextLength(block, issues)
      return
    case 'figure': {
      const figureId = block.attrs.figureId ?? ''
      if (figureId === '') {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::figure 缺 figureId 属性' })
      } else if (!deps.figureIds.has(figureId)) {
        issues.push({ code: 'figure_ref_unknown', line: block.line, message: `figureId=${figureId} 不在本节图示集内` })
      }
      const caption = block.attrs.caption ?? ''
      if (caption.length < 1 || caption.length > 200) {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::figure caption 必填且 1~200 字' })
      }
      if (block.attrs.unitId) requireUnit(block, deps, issues)
      return
    }
    case 'clip': {
      const unit = requireUnit(block, deps, issues)
      const assetId = block.attrs.assetId ?? ''
      const from = Number(block.attrs.from)
      const to = Number(block.attrs.to)
      const caption = block.attrs.caption ?? ''
      if (caption.length < 1 || caption.length > 200) {
        issues.push({ code: 'body_schema_failed', line: block.line, message: ':::clip caption 必填且 1~200 字' })
      }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= to) {
        issues.push({ code: 'clip_not_grounded', line: block.line, message: `:::clip from/to 必须是整数且 0 ≤ from < to（得到 from=${block.attrs.from} to=${block.attrs.to}）` })
        return
      }
      if (to - from > CLIP_MAX_WINDOW_MS / 1000) {
        issues.push({ code: 'clip_not_grounded', line: block.line, message: `:::clip 窗长 ${(to - from)}s 超过 60s 上限` })
        return
      }
      if (!unit) return
      if (assetId !== unit.assetId) {
        issues.push({ code: 'clip_not_grounded', line: block.line, message: `:::clip assetId=${assetId} 与所引素材单元的素材（${unit.assetId}）不一致` })
        return
      }
      const fromMs = from * 1000
      const toMs = to * 1000
      if (fromMs < unit.startMs || toMs > unit.endMs) {
        issues.push({
          code: 'clip_not_grounded',
          line: block.line,
          message: `:::clip 时间窗 ${from}~${to}s 未完整落在素材单元窗内（${(unit.startMs / 1000).toFixed(1)}s ~ ${(unit.endMs / 1000).toFixed(1)}s）`,
        })
      }
      return
    }
    case 'annotation':
      validateAnnotation(block, deps, issues)
      return
    case 'replay':
      validateReplay(block, deps, issues)
      return
    default:
      return
  }
}

/**
 * :::annotation（arch/06 §2.2/§2.4）：老师标注详情卡。
 * 接地口径——atMs 落素材单元窗内、d 落案例窗内**且**是该股真实交易日、
 * glossary 术语 ∈ 概念表；映射不到行情时按「行情暂不可用」降级，不伪造。
 */
function validateAnnotation(block: DslBlock, deps: ValidatorDeps, issues: DslIssue[]): void {
  const unit = requireUnit(block, deps, issues)
  const assetId = block.attrs.assetId ?? ''
  const code = block.attrs.code ?? ''
  const kind = block.attrs.kind ?? ''
  const atMs = Number(block.attrs.atMs)

  if (!ANNOTATION_KINDS.has(kind)) {
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::annotation kind 只能是 structure/invalidation/rhythm（得到 ${kind}）`,
    })
  }
  if (!Number.isInteger(atMs) || atMs < 0) {
    issues.push({
      code: 'annotation_not_grounded',
      line: block.line,
      message: `:::annotation atMs 必须是毫秒整数（得到 ${block.attrs.atMs}）`,
    })
  }
  if (assetId === '') {
    issues.push({ code: 'body_schema_failed', line: block.line, message: ':::annotation 缺 assetId 属性' })
  } else if (unit && assetId !== unit.assetId) {
    issues.push({
      code: 'annotation_not_grounded',
      line: block.line,
      message: `:::annotation assetId=${assetId} 与所引素材单元的素材（${unit.assetId}）不一致`,
    })
  }
  if (unit && Number.isInteger(atMs) && (atMs < unit.startMs || atMs > unit.endMs)) {
    issues.push({
      code: 'annotation_not_grounded',
      line: block.line,
      message: `:::annotation atMs=${atMs} 未落在素材单元窗内（${unit.startMs}~${unit.endMs}ms）`,
    })
  }
  if (!/^\d{6}$/.test(code)) {
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::annotation code 必填且为 6 位案例股代码（得到 ${code}）`,
    })
    return
  }

  const body = parseAnnotationBody(block, issues)
  if (!body) return

  if (!deps.stockCodes.has(code)) {
    issues.push({
      code: 'stock_not_in_list',
      line: block.line,
      message: `:::annotation code=${code} 不在本节案例股清单内`,
    })
    return
  }
  const window = deps.caseWindows.get(code)
  if (!window) {
    issues.push({
      code: 'annotation_date_out_of_window',
      line: block.line,
      message: `:::annotation code=${code} 没有案例窗口`,
    })
    return
  }
  if (body.d < window.from || body.d > window.to) {
    issues.push({
      code: 'annotation_date_out_of_window',
      line: block.line,
      message: `:::annotation d=${body.d} 不在案例股 ${code} 的案例窗内（${window.from} ~ ${window.to}）`,
    })
  }
  const days = deps.tradingDays.get(code)
  if (days && !days.has(body.d)) {
    issues.push({
      code: 'annotation_date_not_trading_day',
      line: block.line,
      message: `:::annotation d=${body.d} 不是案例股 ${code} 的真实交易日`,
    })
  }
  for (const term of body.glossary) {
    if (findTerm(deps.terms, term)) continue
    issues.push({
      code: 'annotation_term_unknown',
      line: block.line,
      term,
      suggestion: nearestTerm(deps.terms, term),
      message: `:::annotation 术语「${term}」不在课程概念表（name 与别名全词匹配）`,
    })
  }
}

/**
 * :::replay（arch/06 §2.2）：正文内嵌逐根回放入口，按 code 解析本节唯一的
 * bar-replay-decision 课件。**DSL 不携带 widgetId**——正文↔课件写入顺序不耦合。
 */
function validateReplay(block: DslBlock, deps: ValidatorDeps, issues: DslIssue[]): void {
  const code = block.attrs.code ?? ''
  const caption = block.attrs.caption ?? ''
  if (!/^\d{6}$/.test(code)) {
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::replay code 必填且为 6 位案例股代码（得到 ${code}）`,
    })
    return
  }
  if (caption.length < 1 || caption.length > 200) {
    issues.push({ code: 'body_schema_failed', line: block.line, message: ':::replay caption 必填且 1~200 字' })
  }
  if (!deps.stockCodes.has(code)) {
    issues.push({
      code: 'stock_not_in_list',
      line: block.line,
      message: `:::replay code=${code} 不在本节案例股清单内`,
    })
    return
  }
  const count = deps.replayCodes.get(code) ?? 0
  if (count === 0) {
    issues.push({
      code: 'replay_widget_unknown',
      line: block.line,
      message: `:::replay code=${code} 在本节没有已落库的回放课件`,
    })
  } else if (count > 1) {
    issues.push({
      code: 'replay_widget_ambiguous',
      line: block.line,
      message: `:::replay code=${code} 匹配到 ${count} 份回放课件，定位不唯一`,
    })
  }
}

function parseAnnotationBody(
  block: DslBlock,
  issues: DslIssue[],
): { d: string; label: string; quote: string; glossary: string[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(block.body)
  } catch {
    issues.push({ code: 'body_schema_failed', line: block.line, message: ':::annotation body 不是合法 JSON' })
    return null
  }
  const result = dslAnnotationBody.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::annotation body 形状不合约定：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    })
    return null
  }
  return result.data
}

function validateJsonBlock(block: DslBlock, issues: DslIssue[]): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(block.body)
  } catch {
    issues.push({ code: 'body_schema_failed', line: block.line, message: `:::${block.directive} body 不是合法 JSON` })
    return
  }
  // 与渲染器共用契约里的形状（packages/contracts/src/dsl.ts）——字段名只此一份。
  const schema =
    block.directive === 'cards'
      ? dslCardsBody
      : block.directive === 'bignum'
        ? dslBignumBody
        : block.directive === 'cmp'
          ? dslCmpBody
          : dslTimelineBody
  const result = schema.safeParse(parsed)
  if (!result.success) {
    const first = result.error.issues[0]
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::${block.directive} body 形状不合约定：${first?.path.join('.') ?? ''} ${first?.message ?? ''}`.trim(),
    })
  }
}

function checkTextLength(block: DslBlock, issues: DslIssue[]): void {
  const limit = TEXT_LIMITS[block.directive]
  if (limit === undefined) return
  if (block.body.length < 1 || block.body.length > limit) {
    issues.push({
      code: 'body_schema_failed',
      line: block.line,
      message: `:::${block.directive} 正文须 1~${limit} 字（得到 ${block.body.length}）`,
    })
  }
}

/** 全词匹配：trim + 忽略大小写的完整相等（非子串——防误杀）。 */
function findTerm(terms: readonly string[], title: string): string | null {
  const norm = title.trim().toLowerCase()
  if (norm === '') return null
  for (const term of terms) {
    if (term.trim().toLowerCase() === norm) return term
  }
  return null
}

/** 最近似术语建议（Levenshtein 距离最小且不超过词长一半，防止瞎推荐）。 */
export function nearestTerm(terms: readonly string[], title: string): string | undefined {
  const norm = title.trim().toLowerCase()
  if (norm === '' || terms.length === 0) return undefined
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const term of terms) {
    const candidate = term.trim().toLowerCase()
    const distance = levenshtein(norm, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = term
    }
  }
  const threshold = Math.max(2, Math.floor(norm.length / 2))
  return best !== undefined && bestDistance <= threshold ? best : undefined
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost)
    }
    prev = curr
  }
  return prev[b.length]!
}
