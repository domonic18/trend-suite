'use client'

import { Badge } from '@/components/ui/badge'

import type { DslAnnotationBody } from '@trend-suite/contracts'

/**
 * 老师标注卡（:::annotation，arch/06 §2.2）：日期 + 说明 + 老师原话 + 术语。
 * 标注按**交易日期**定位 K 线（不用 bar 索引——索引会随行情回填漂移），
 * 术语来自课程概念表（服务端已校验全词匹配）。
 */

const KIND_LABELS: Record<string, string> = {
  structure: '结构',
  invalidation: '失效',
  rhythm: '节奏',
}

export function AnnotationCard({
  body,
  kind,
  unitId,
  atMs,
  code,
}: {
  body: DslAnnotationBody
  kind: string
  unitId: string
  atMs: number
  code: string
}) {
  return (
    <div className="doc-annotation">
      <div className="doc-annotation-head">
        <Badge className="tag ready">{KIND_LABELS[kind] ?? '标注'}</Badge>
        <b>{body.label}</b>
        <span className="mono meta">{body.d}</span>
        <span className="grow" />
        <span className="meta">
          {code} · 素材单元 {unitId} · {(atMs / 1000).toFixed(1)}s
        </span>
      </div>
      <blockquote>{body.quote}</blockquote>
      <div className="doc-annotation-terms">
        {body.glossary.map((term) => (
          <span key={term} className="tag">
            {term}
          </span>
        ))}
      </div>
    </div>
  )
}
