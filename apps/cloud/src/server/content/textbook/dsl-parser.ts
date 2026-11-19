import {
  DSL_VERSION,
  type DslAst,
  type DslBlock,
  type DslInlineAnchor,
  type DslSegment,
} from '@trend-suite/contracts'

/**
 * 教材 DSL 解析器（arch/06 §2 语法权威）：Markdown 子集散文 + `:::` 容器块
 * + `[[unit:id|label]]` / `[[stock:code|label]]` 内联锚 → DslAst。
 * 纯函数、无 server-only——客户端渲染器直接复用（渲染同源，arch/06 §1）。
 * 语法错抛 DslSyntaxError（带行号），语义错由 validator 产 DslIssue。
 */

export class DslSyntaxError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(`${message}（第 ${line} 行）`)
    this.name = 'DslSyntaxError'
    this.line = line
  }
}

const ANCHOR_RE = /\[\[(unit|stock):([^\|\]\s]+)\|([^\]]+)\]\]/g
const OPEN_RE = /^:::\s*([A-Za-z][\w-]*)(.*)$/
const ATTR_RE = /([\w-]+)=("([^"]*)"|[^\s]+)/g

export function parseDsl(source: string): DslAst {
  const lines = source.split('\n')
  const segments: DslSegment[] = []
  const anchors: DslInlineAnchor[] = []

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!
    const trimmed = raw.trim()

    const open = OPEN_RE.exec(trimmed)
    if (open) {
      const startLine = i + 1
      const directive = open[1]!
      const attrs = parseAttrs(open[2] ?? '')
      const bodyLines: string[] = []
      i += 1
      let closed = false
      while (i < lines.length) {
        if (lines[i]!.trim() === ':::') {
          closed = true
          i += 1
          break
        }
        bodyLines.push(lines[i]!)
        i += 1
      }
      if (!closed) throw new DslSyntaxError(`容器块 :::${directive} 未闭合`, startLine)
      const body = bodyLines.join('\n').trim()
      const block: DslBlock = { directive, attrs, body, line: startLine }
      segments.push({ type: 'block', block })
      anchors.push(...extractAnchors(body, startLine + 1))
      continue
    }

    if (trimmed === '') {
      i += 1
      continue
    }

    // 散文段：连续非空行合为一段（渲染层按 Markdown 子集展开标题/列表/粗体）。
    const proseLines: string[] = []
    const startLine = i + 1
    while (i < lines.length) {
      const t = lines[i]!.trim()
      if (t === '' || OPEN_RE.test(t)) break
      proseLines.push(lines[i]!)
      anchors.push(...extractAnchors(lines[i]!, i + 1))
      i += 1
    }
    segments.push({ type: 'prose', text: proseLines.join('\n'), line: startLine })
  }

  return { version: DSL_VERSION, segments, anchors }
}

function extractAnchors(text: string, line: number): DslInlineAnchor[] {
  const out: DslInlineAnchor[] = []
  for (const match of text.matchAll(ANCHOR_RE)) {
    out.push({ kind: match[1] as 'unit' | 'stock', ref: match[2]!, label: match[3]!.trim(), line })
  }
  return out
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(ATTR_RE)) {
    const value = match[2]!.startsWith('"') ? (match[3] ?? '') : match[2]!
    attrs[match[1]!] = value
  }
  return attrs
}

/** 从 AST 收集全部 unit 引用（锚点 + 块属性 unitId），去重保序——content 视图与校验共用。 */
export function collectUnitRefs(ast: DslAst): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const push = (ref: string) => {
    if (ref === '' || seen.has(ref)) return
    seen.add(ref)
    ordered.push(ref)
  }
  for (const anchor of ast.anchors) {
    if (anchor.kind === 'unit') push(anchor.ref)
  }
  for (const segment of ast.segments) {
    if (segment.type !== 'block') continue
    const unitId = segment.block.attrs.unitId
    if (unitId) push(unitId)
  }
  return ordered
}

/** 从 AST 收集全部 stock 引用（仅内联锚）。 */
export function collectStockRefs(ast: DslAst): string[] {
  return ast.anchors.filter((a) => a.kind === 'stock').map((a) => a.ref)
}
