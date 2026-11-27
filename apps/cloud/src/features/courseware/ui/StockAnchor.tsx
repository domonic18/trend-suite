'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CaseStockView, SectionQuotesView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getSectionQuotes } from '../api'
import { KlineChart } from './KlineChart'

/**
 * 个股锚 [[stock:code|名称]]：正文内联芯片，点开懒加载节行情并
 * 复用 KlineChart 定位该案例股——预览页不预先拉全部行情。
 */

export function StockAnchor({
  code,
  label,
  courseId,
  sectionId,
  stock,
}: {
  code: string
  label: string
  courseId: string
  sectionId: string
  /** 本节案例股清单里的元信息（不在清单里只展示芯片）。 */
  stock: CaseStockView | undefined
}) {
  const [open, setOpen] = useState(false)
  const [quotes, setQuotes] = useState<SectionQuotesView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = useCallback(() => setOpen((v) => !v), [])

  useEffect(() => {
    if (!open || quotes) return
    let cancelled = false
    void (async () => {
      try {
        const view = await getSectionQuotes(courseId, sectionId)
        if (!cancelled) setQuotes(view)
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '行情加载失败')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, quotes, courseId, sectionId])

  const matched = quotes?.stocks.find((s) => s.code === code)

  return (
    <span className="stock-anchor">
      <button type="button" className={`stock-chip${open ? ' on' : ''}`} onClick={toggle} title={label}>
        {label}
      </button>
      {open ? (
        <span className="stock-panel">
          {stock ? (
            <span className="meta">
              {stock.exchange}
              {stock.code} · {stock.period === '1d' ? '日线' : '周线'} · {stock.windowStart} ~ {stock.windowEnd}
            </span>
          ) : (
            <span className="meta">该代码不在本节案例股清单内</span>
          )}
          {error ? <span className="text-destructive">{error}</span> : null}
          {!error && !quotes ? <span className="meta">行情加载中…</span> : null}
          {matched ? <KlineChart stock={matched} /> : null}
          {quotes && !matched && !error ? <span className="meta">行情暂未覆盖该代码</span> : null}
        </span>
      ) : null}
    </span>
  )
}
