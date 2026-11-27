'use client'

import { Badge } from '@/components/ui/badge'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { Button } from '@/components/ui/button'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { DSL_VERSION, type SectionContentView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getSectionContent } from '../api'
import { parseDsl } from '@trend-suite/dsl'
import { DslRenderer } from './DslRenderer'
import { WidgetHost } from './widgets/WidgetHost'

/**
 * 节教材预览（迭代 6）：取 SectionContentView 单次全量（正文 + 三路图示 +
 * 内联证据单元 + 课件），渲染全部在客户端完成；正文未产出/被拒给明确占位。
 * 迭代 7 追加：课件清单（11 类全部渲染，含断言证明徽章）。
 */

export function SectionPreview({ courseId, sectionId }: { courseId: string; sectionId: string }) {
  const [content, setContent] = useState<SectionContentView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setContent(await getSectionContent(courseId, sectionId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '正文加载失败')
    }
  }, [courseId, sectionId])

  useEffect(() => {
    void load()
  }, [load])

  const figuresById = useMemo(
    () => new Map((content?.figures ?? []).map((figure) => [figure.id, figure])),
    [content],
  )

  /** 正文里已内联渲染的 :::replay code（清单里不重复列）。 */
  const inlineReplayCodes = useMemo(() => {
    if (!content?.body) return new Set<string>()
    try {
      const ast = parseDsl(content.body, content.dslVersion ?? DSL_VERSION)
      const codes = new Set<string>()
      for (const segment of ast.segments) {
        if (segment.type !== 'block') continue
        if (segment.block.directive !== 'replay') continue
        const code = segment.block.attrs.code
        if (code) codes.add(code)
      }
      return codes
    } catch {
      return new Set<string>()
    }
  }, [content])

  if (error && !content) return <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  if (!content) return <div className="empty">正文加载中…</div>

  const listedWidgets = content.widgets.filter(
    (widget) => !(widget.code && inlineReplayCodes.has(widget.code)),
  )

  return (
    <div className="doc-wrap">
      {error ? <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{error}</AlertDescription>
    </Alert> : null}
      <div className="doc-top">
        <b>{content.title}</b>
        <span className="meta">
          节 {content.sectionId} · DSL v{content.dslVersion ?? '-'} · {content.figures.length} 图示 ·{' '}
          {content.caseStocks.length} 案例股 · {content.widgets.length} 课件
        </span>
        <span className="grow" />
        {content.bodyStatus === 'draft' ? <Badge className="tag ready">正文已产出</Badge> : null}
        {content.bodyStatus === 'rejected' ? <Badge className="tag draft">正文曾被复检拒绝</Badge> : null}
        <Button variant="outline" size="sm" onClick={() => void load()}>
          刷新
        </Button>
      </div>
      <DslRenderer content={content} />
      {listedWidgets.length > 0 ? (
        <section className="widget-list">
          <b className="widget-list-title">本节课件（{listedWidgets.length}）</b>
          {listedWidgets.map((widget) => (
            <WidgetHost key={widget.id} widget={widget} figures={figuresById} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
