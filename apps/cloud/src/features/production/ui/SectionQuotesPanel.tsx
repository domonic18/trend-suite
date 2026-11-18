'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SectionQuotesView, StockQuotesView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getSectionQuotes, resyncQuotes } from '../api'
import { KlineChart } from './KlineChart'

/**
 * 节产物面板·行情（迭代 5）：案例股清单卡 + K 线预览 + 常驻复权声明。
 * 声明文案来自契约单一事实源；行情不可用显式占位，绝不画假数。
 */

const STATUS_BADGE: Record<StockQuotesView['marketStatus'], { className: string; text: string }> = {
  ok: { className: 'tag ready', text: '行情已采集' },
  partial: { className: 'tag processing', text: '行情部分覆盖' },
  unavailable: { className: 'tag draft', text: '行情暂不可用' },
}

function periodText(period: StockQuotesView['period']): string {
  return period === '1d' ? '日线' : '周线'
}

export function SectionQuotesPanel({
  courseId,
  sectionId,
  canResync,
}: {
  courseId: string
  sectionId: string
  canResync: boolean
}) {
  const [quotes, setQuotes] = useState<SectionQuotesView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setQuotes(await getSectionQuotes(courseId, sectionId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '行情加载失败')
    } finally {
      setBusy(false)
    }
  }, [courseId, sectionId])

  useEffect(() => {
    void load()
  }, [load])

  const resync = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await resyncQuotes(courseId, sectionId)
      // 重投后步骤 2/3 重跑需要时间：先提示，面板数据由看板轮询间接刷新。
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重新同步失败，请稍后再试')
      setBusy(false)
    }
  }, [courseId, sectionId, load])

  if (error && !quotes) return <div className="notice err">{error}</div>
  if (!quotes) return <div className="empty">行情加载中…</div>

  return (
    <div className="sq-panel">
      {error ? <div className="notice err">{error}</div> : null}
      <div className="sq-actions">
        <span className="meta">
          {quotes.stocks.length} 只案例股{quotes.stocks.some((s) => s.marketStatus !== 'ok') ? ' · 存在未覆盖窗口' : ''}
        </span>
        {canResync ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void resync()}>
            {busy ? '同步中…' : '重新同步行情'}
          </button>
        ) : null}
      </div>

      {quotes.stocks.map((stock) => {
        const badge = STATUS_BADGE[stock.marketStatus]
        return (
          <div className="card sq-stock" key={stock.id}>
            <div className="sq-head">
              <b>
                {stock.name} {stock.exchange}
                {stock.code}
              </b>
              <span className="meta">
                {periodText(stock.period)} · {stock.windowStart} ~ {stock.windowEnd} · {stock.bars.length} 根
              </span>
              <span className={badge.className}>
                <i />
                {badge.text}
              </span>
            </div>
            {stock.events.length > 0 ? (
              <div className="sq-events">
                {stock.eventAnchors.map((anchor) => (
                  <span className="tag gray" key={`${anchor.date}-${anchor.label}`}>
                    {anchor.date}
                    {anchor.resolvedDate && anchor.resolvedDate !== anchor.date ? `→${anchor.resolvedDate}` : ''}{' '}
                    {anchor.label}
                  </span>
                ))}
              </div>
            ) : null}
            {stock.notes.length > 0 ? (
              <div className="sq-notes">
                {stock.notes.map((note) => (
                  <span className="tag processing" key={note}>
                    {note}
                  </span>
                ))}
              </div>
            ) : null}
            <KlineChart stock={stock} />
            <div className="kline-foot">
              <span>
                {stock.lastSyncedAt ? `最近同步 ${stock.lastSyncedAt.slice(0, 19).replace('T', ' ')}` : '尚未同步'}
              </span>
            </div>
          </div>
        )
      })}

      {quotes.stocks.length === 0 ? <div className="empty">本节还没有案例股清单。</div> : null}
      <div className="kline-foot sq-declaration">{quotes.declaration}</div>
    </div>
  )
}
