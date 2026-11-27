'use client'

import { useEffect, useMemo, useRef } from 'react'
import { dispose, init, type KLineData } from 'klinecharts'
import type { StockQuotesView } from '@trend-suite/contracts'
import { klineTokenStyles, readKlineToken } from '@/features/lib/klineTheme'

/**
 * 教学 K 线（教师预览版）：klinecharts 引擎——蜡烛 + 成交量 + MA5/10/60 +
 * 事件锚点竖线（verticalStraightLine overlay）；行情不可用画占位框，绝不编造
 * 数值。悬停读数走引擎内置 crosshair tooltip（OHLCV + MA 值），「数值可核」。
 * 网格与轴标签色从 CSS token 取（--k-grid/--k-label），切主题时 setStyles 重设。
 */

export function KlineChart({ stock }: { stock: StockQuotesView }) {
  const wrapRef = useRef<HTMLDivElement>(null)

  const bars = stock.bars
  /** 事件锚点 → 柱下标（归一交易日；无对应柱则最近一根）。 */
  const anchorIndex = useMemo(() => {
    return stock.eventAnchors.map((anchor) => {
      let idx = -1
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i]
        if (bar && bar.d <= anchor.date) idx = i
        else break
      }
      return { anchor, idx }
    })
  }, [stock.eventAnchors, bars])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || bars.length === 0) return

    const chart = init(el, {
      locale: 'zh-CN',
      styles: klineTokenStyles() as never,
    })
    if (!chart) return
    chart.setSymbol({ ticker: stock.code, pricePrecision: 2, volumePrecision: 0 })
    chart.setPeriod({ type: stock.period === '1d' ? 'day' : 'week', span: 1 })
    chart.setDataLoader({
      getBars: ({ callback }) =>
        callback(
          bars.map((bar, index): KLineData => {
            const parsed = Date.parse(bar.d)
            return {
              timestamp: Number.isNaN(parsed) ? index : parsed,
              open: bar.o,
              high: bar.h,
              low: bar.l,
              close: bar.c,
              volume: bar.v,
            }
          }),
        ),
    })
    chart.createIndicator({ name: 'MA', calcParams: [5, 10, 60], paneId: 'candle_pane' }, false)

    // 事件锚点竖线（overlay：只画有对应柱的）
    for (const { anchor, idx } of anchorIndex) {
      if (idx < 0) continue
      chart.createOverlay({
        name: 'verticalStraightLine',
        points: [{ dataIndex: idx }],
        extendData: anchor.label,
        styles: {
          verticalStraightLine: { line: { show: true, color: readKlineToken('--k-label', '#8b94a9'), style: 'dashed', size: 1 }, text: { show: true, style: 'fill', color: '#fff', backgroundColor: readKlineToken('--k-label', '#8b94a9') } },
        },
      })
    }

    // 工作台切换主题（data-wb-theme 变化）时按新 token 重设样式
    const themed = el.closest('[data-wb-theme]')
    const themeObserver = new MutationObserver(() => chart.setStyles(klineTokenStyles() as never))
    if (themed) themeObserver.observe(themed, { attributes: true, attributeFilter: ['data-wb-theme'] })

    return () => {
      themeObserver.disconnect()
      dispose(el)
    }
  }, [bars, anchorIndex, stock.code, stock.period])

  if (stock.marketStatus === 'unavailable') {
    return (
      <div className="kline-empty">
        <b>行情暂不可用</b>
        <p>行情源拉取失败，本节 K 线未产出——不编造数值。可用「重新同步行情」在源恢复后补数。</p>
      </div>
    )
  }

  return (
    <div className="kline-preview">
      <div className="kline-legend">
        <span className="kline-readout">{stock.code} · {stock.period === '1d' ? '日线' : '周线'} · {stock.windowStart} ~ {stock.windowEnd}</span>
      </div>
      <div ref={wrapRef} style={{ width: '100%', height: 320 }} />
    </div>
  )
}
