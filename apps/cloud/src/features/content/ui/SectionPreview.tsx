'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SectionContentView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getSectionContent } from '@/features/production/api'
import { DslRenderer } from './DslRenderer'

/**
 * 节教材预览（迭代 6）：取 SectionContentView 单次全量（正文 + 三路图示 +
 * 内联证据单元），渲染全部在客户端完成；正文未产出/被拒给明确占位。
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

  if (error && !content) return <div className="notice err">{error}</div>
  if (!content) return <div className="empty">正文加载中…</div>

  return (
    <div className="doc-wrap">
      {error ? <div className="notice err">{error}</div> : null}
      <div className="doc-top">
        <b>{content.title}</b>
        <span className="meta">
          节 {content.sectionId} · DSL v{content.dslVersion ?? '-'} · {content.figures.length} 图示 ·{' '}
          {content.caseStocks.length} 案例股
        </span>
        <span className="grow" />
        {content.bodyStatus === 'draft' ? <span className="tag ready">正文已产出</span> : null}
        {content.bodyStatus === 'rejected' ? <span className="tag draft">正文曾被复检拒绝</span> : null}
        <button type="button" className="btn" onClick={() => void load()}>
          刷新
        </button>
      </div>
      <DslRenderer content={content} />
    </div>
  )
}
