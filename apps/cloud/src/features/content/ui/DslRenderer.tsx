'use client'

import { useState } from 'react'
import type { CaseStockView, DslBlock, FigureView, SectionContentView, SourceUnitView } from '@trend-suite/contracts'
import { parseDsl } from '@/server/content/textbook/dsl-parser'
import { ClipCard } from './ClipCard'
import { FigureCard } from './FigureCard'
import { StockAnchor } from './StockAnchor'
import { UnitAnchorCard } from './UnitAnchorCard'

/**
 * 正文 DSL 渲染器（arch/06 §10：渲染在客户端现场完成，绝不存渲染后 HTML）。
 * 解析与云端复检同源（同一个 parseDsl）；散文段展开 Markdown 子集
 * （标题/列表/粗体）与 [[unit:]]/[[stock:]] 内联锚；容器块按 v1 白名单分发。
 */

const ANCHOR_SPLIT = /\[\[(unit|stock):([^\|\]\s]+)\|([^\]]+)\]\]/g
const BOLD_SPLIT = /\*\*(.+?)\*\*/g

function jsonBody<T>(block: DslBlock): T | null {
  try {
    return JSON.parse(block.body) as T
  } catch {
    return null
  }
}

export function DslRenderer({ content }: { content: SectionContentView }) {
  if (!content.body) {
    return <div className="empty">本节还没有正文产出（正文步完成后可预览）。</div>
  }
  let ast
  try {
    ast = parseDsl(content.body)
  } catch (err) {
    return <div className="notice err">正文解析失败：{(err as Error).message}</div>
  }
  const unitsById = new Map(content.units.map((unit) => [unit.id, unit]))
  const stocksByCode = new Map(content.caseStocks.map((stock) => [stock.code, stock]))
  const figuresById = new Map(content.figures.map((figure) => [figure.id, figure]))

  return (
    <article className="doc-body">
      {ast.segments.map((segment, index) =>
        segment.type === 'prose' ? (
          <ProseBlock
            key={`p${segment.line}-${index}`}
            text={segment.text}
            courseId={content.courseId}
            sectionId={content.sectionId}
            unitsById={unitsById}
            stocksByCode={stocksByCode}
          />
        ) : (
          <BlockView
            key={`b${segment.block.line}-${index}`}
            block={segment.block}
            unitsById={unitsById}
            figuresById={figuresById}
          />
        ),
      )}
    </article>
  )
}

// ---------------------------------------------------------------- 散文段

function ProseBlock({
  text,
  courseId,
  sectionId,
  unitsById,
  stocksByCode,
}: {
  text: string
  courseId: string
  sectionId: string
  unitsById: Map<string, SourceUnitView>
  stocksByCode: Map<string, CaseStockView>
}) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return
    out.push(<InlineParagraph key={key} text={paragraph.join('\n')} courseId={courseId} sectionId={sectionId} unitsById={unitsById} stocksByCode={stocksByCode} />)
    paragraph = []
  }
  const flushList = (key: string) => {
    if (list.length === 0) return
    out.push(
      <ul key={key} className="doc-list">
        {list.map((item, i) => (
          <li key={i}>
            <InlineText text={item} courseId={courseId} sectionId={sectionId} stocksByCode={stocksByCode} />
          </li>
        ))}
      </ul>,
    )
    list = []
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph(`p-${i}`)
      flushList(`l-${i}`)
      const level = heading[1]!.length
      const Tag = (['h2', 'h3', 'h4', 'h5'][level - 1] ?? 'h5') as 'h2'
      out.push(<Tag key={`h-${i}`}>{heading[2]}</Tag>)
      return
    }
    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph(`p-${i}`)
      list.push(trimmed.replace(/^[-*]\s+/, ''))
      return
    }
    if (trimmed === '') {
      flushParagraph(`p-${i}`)
      flushList(`l-${i}`)
      return
    }
    flushList(`l-${i}`)
    paragraph.push(trimmed)
  })
  flushParagraph('p-end')
  flushList('l-end')
  return <>{out}</>
}

function InlineParagraph(props: {
  text: string
  courseId: string
  sectionId: string
  unitsById: Map<string, SourceUnitView>
  stocksByCode: Map<string, CaseStockView>
}) {
  const [unitId, setUnitId] = useState<string | null>(null)
  const unit = unitId ? props.unitsById.get(unitId) : undefined
  return (
    <p className="doc-para">
      <InlineText {...props} onUnit={(id) => setUnitId((cur) => (cur === id ? null : id))} activeUnitId={unitId} />
      {unitId && unit ? <UnitAnchorCard unit={unit} courseId={props.courseId} onClose={() => setUnitId(null)} /> : null}
      {unitId && !unit ? <div className="notice err">证据单元 {unitId} 不在本节引用清单内</div> : null}
    </p>
  )
}

function InlineText({
  text,
  courseId,
  sectionId,
  stocksByCode,
  onUnit,
  activeUnitId,
}: {
  text: string
  courseId: string
  sectionId: string
  stocksByCode: Map<string, CaseStockView>
  onUnit?: (unitId: string) => void
  activeUnitId?: string | null
}) {
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(ANCHOR_SPLIT)) {
    const index = match.index ?? 0
    if (index > last) parts.push(<Bold key={key++} text={text.slice(last, index)} />)
    const kind = match[1] as 'unit' | 'stock'
    const ref = match[2]!
    const label = match[3]!.trim()
    if (kind === 'unit') {
      const active = activeUnitId === ref
      parts.push(
        <button
          key={key++}
          type="button"
          className={`unit-anchor${active ? ' on' : ''}`}
          onClick={() => onUnit?.(ref)}
          title="查看原始素材证据"
        >
          {label}
        </button>,
      )
    } else {
      parts.push(
        <StockAnchor key={key++} code={ref} label={label} courseId={courseId} sectionId={sectionId} stock={stocksByCode.get(ref)} />,
      )
    }
    last = index + match[0].length
  }
  if (last < text.length) parts.push(<Bold key={key++} text={text.slice(last)} />)
  return <>{parts}</>
}

function Bold({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(BOLD_SPLIT)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    parts.push(<b key={key++}>{match[1]}</b>)
    last = index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ---------------------------------------------------------------- 容器块

function BlockView({
  block,
  unitsById,
  figuresById,
}: {
  block: DslBlock
  unitsById: Map<string, SourceUnitView>
  figuresById: Map<string, FigureView>
}) {
  switch (block.directive) {
    case 'think':
      return (
        <details className="doc-think">
          <summary>{block.attrs.title ?? '想一想'}</summary>
          <p>{block.body}</p>
        </details>
      )
    case 'sidenote':
      return (
        <aside className="doc-note">
          <b>{block.attrs.title}</b>
          {block.body}
        </aside>
      )
    case 'warn':
      return (
        <div className={`doc-warn warn-${block.attrs.variant ?? 'risk'}`}>
          <b>{block.attrs.title || '注意'}</b>
          {block.body}
        </div>
      )
    case 'board':
      return (
        <div className="doc-board">
          <div className="bh">
            <span>板书</span>
            <span>{block.attrs.unitId ? '依据素材单元' : ''}</span>
          </div>
          <blockquote>{block.body}</blockquote>
        </div>
      )
    case 'cards': {
      const data = jsonBody<{ items?: { t?: string; title?: string; d?: string; text?: string }[] }>(block)
      if (!data?.items) return <UnknownBlock block={block} />
      return (
        <div className="doc-cards">
          {data.items.map((item, i) => (
            <div key={i}>
              <b>{item.t ?? item.title}</b>
              <span>{item.d ?? item.text}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'bignum': {
      const data = jsonBody<{ items?: { v?: string; label?: string }[] }>(block)
      if (!data?.items) return <UnknownBlock block={block} />
      return (
        <div className="doc-bignum">
          {data.items.map((item, i) => (
            <div key={i}>
              <b>{item.v}</b>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )
    }
    case 'cmp': {
      const data = jsonBody<{
        left?: { title?: string; points?: string[] }
        right?: { title?: string; points?: string[] }
      }>(block)
      if (!data?.left || !data.right) return <UnknownBlock block={block} />
      const column = (side: { title?: string; points?: string[] }, key: string) => (
        <div key={key}>
          <b>{side.title}</b>
          <ul>
            {(side.points ?? []).map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      )
      return (
        <div className="doc-cmp">
          {column(data.left, 'left')}
          {column(data.right, 'right')}
        </div>
      )
    }
    case 'timeline': {
      const data = jsonBody<{ events?: { date?: string; title?: string; desc?: string }[] }>(block)
      if (!data?.events) return <UnknownBlock block={block} />
      return (
        <div className="doc-timeline">
          {data.events.map((event, i) => (
            <div key={i}>
              <span className="mono">{event.date}</span>
              <b>{event.title}</b>
              {event.desc ? <span>{event.desc}</span> : null}
            </div>
          ))}
        </div>
      )
    }
    case 'figure': {
      const figure = figuresById.get(block.attrs.figureId ?? '')
      if (!figure) {
        return <div className="notice err">图示 {block.attrs.figureId} 不在本节图示集内</div>
      }
      return <FigureCard figure={figure} />
    }
    case 'clip': {
      const unit = unitsById.get(block.attrs.unitId ?? '')
      return (
        <ClipCard
          assetId={block.attrs.assetId ?? ''}
          from={Number(block.attrs.from)}
          to={Number(block.attrs.to)}
          caption={block.attrs.caption ?? '片段'}
          unit={unit}
        />
      )
    }
    default:
      return <UnknownBlock block={block} />
  }
}

function UnknownBlock({ block }: { block: DslBlock }) {
  return (
    <div className="notice">
      未支持的容器块 {`:::${block.directive}`}（本渲染器为 DSL v1 白名单）——原文：
      <pre>{block.body}</pre>
    </div>
  )
}
