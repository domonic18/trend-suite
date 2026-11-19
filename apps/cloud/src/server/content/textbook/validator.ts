import {
  dslBignumBody,
  dslCardsBody,
  dslCmpBody,
  dslQuotas,
  dslTimelineBody,
  V1_DIRECTIVES,
  V2_DIRECTIVES,
  type DslAst,
  type DslIssue,
} from '@trend-suite/contracts'
import type { DslBlock } from '@trend-suite/contracts'

/**
 * 教材 DSL 第 2 层语义校验（arch/06 §2.4，随正文写入复检）：
 * 纯函数 + 依赖注入（图示集 / source units / 案例股清单 / 概念词表），
 * 产物 DslIssue[]（带行号；术语违例带词与最近似建议）——空数组即通过。
 * JSON 块形状、配额、clip 窗口接地、术语表全词匹配都在这一层收口。
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
}

const TEXT_LIMITS: Record<string, number> = { think: 800, sidenote: 500, warn: 500, board: 500 }
const WARN_VARIANTS = new Set(['def', 'rule', 'misuse', 'risk'])
const CLIP_MAX_WINDOW_MS = 60_000

export function validateDsl(ast: DslAst, deps: ValidatorDeps): DslIssue[] {
  const issues: DslIssue[] = []
  const quotaCount = new Map<string, number>()

  for (const segment of ast.segments) {
    if (segment.type !== 'block') continue
    const block = segment.block

    if (!V1_DIRECTIVES.includes(block.directive as (typeof V1_DIRECTIVES)[number])) {
      const isV2 = V2_DIRECTIVES.includes(block.directive as (typeof V2_DIRECTIVES)[number])
      issues.push({
        code: 'directive_not_in_version',
        line: block.line,
        message: isV2
          ? `:::${block.directive} 是 v2 溯源块，当前 dslVersion=1 不启用`
          : `未知容器块 :::${block.directive}（v1 白名单外）`,
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
    default:
      return
  }
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
