'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { StockQuotesView } from '@trend-suite/contracts'
import {
  CHART_DOWN,
  CHART_UP,
  MA_PERIODS,
  chartScale,
  drawChart,
  sma,
} from '@/features/lib/chartDraw'

/**
 * 教学 K 线（教师预览版，移植原型 student-course.html 的 #kchart 形态）：
 * 蜡烛 + 成交量 + MA5/10/60（白名单内）+ 事件锚点竖线；行情不可用画占位框，
 * 绝不编造数值。悬停读数用于「数值可核」（验收①）。
 *
 * 绘制内核走 chartDraw——与课件里的合成 K 线**同一份画法**（迭代 6 的教训：
 * 同一个常量在两处各写一遍，迟早对不上）。留白、均线色、命中换算只此一份。
 */

const CHART_HEIGHT = 320

function fmt(n: number): string {
  return n.toFixed(2)
}

export function KlineChart({ stock }: { stock: StockQuotesView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const bars = stock.bars
  const ma = useMemo<Record<number, (number | null)[]>>(
    () => ({ 5: sma(bars, 5), 10: sma(bars, 10), 60: sma(bars, 60) }),
    [bars],
  )
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
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || bars.length === 0) return

    const draw = () => {
      const width = wrap.clientWidth
      if (width === 0) return
      const height = CHART_HEIGHT
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawChart(ctx, {
        width,
        height,
        bars,
        ma,
        anchors: anchorIndex
          .filter((item) => item.idx >= 0)
          .map((item) => ({ idx: item.idx, label: item.anchor.label })),
      })
    }

    draw()
    const observer = new ResizeObserver(() => draw())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [bars, ma, anchorIndex])

  if (stock.marketStatus === 'unavailable') {
    return (
      <div className="kline-empty">
        <b>行情暂不可用</b>
        <p>行情源拉取失败，本节 K 线未产出——不编造数值。可用「重新同步行情」在源恢复后补数。</p>
      </div>
    )
  }

  const hoverBar = hover !== null ? (bars[hover] ?? null) : null
  const hoverMa =
    hover !== null
      ? { 5: ma[5]?.[hover] ?? null, 10: ma[10]?.[hover] ?? null, 60: ma[60]?.[hover] ?? null }
      : null

  let readout = '悬停查看单根数值'
  if (hoverBar) {
    readout = `${hoverBar.d}  开 ${fmt(hoverBar.o)}  高 ${fmt(hoverBar.h)}  低 ${fmt(hoverBar.l)}  收 ${fmt(hoverBar.c)}  量 ${hoverBar.v} 手`
    const m5 = hoverMa?.[5]
    const m10 = hoverMa?.[10]
    if (m5 != null) readout += `  MA5 ${fmt(m5)}`
    if (m10 != null) readout += `  MA10 ${fmt(m10)}`
  }

  return (
    <div className="kline-preview">
      <div className="kline-legend">
        {MA_PERIODS.map(({ n, color }) => (
          <span key={n}>
            <i style={{ background: color }} />
            MA{n}
          </span>
        ))}
        <span>
          <i style={{ background: CHART_UP }} />
          涨
        </span>
        <span>
          <i style={{ background: CHART_DOWN }} />
          跌
        </span>
        <span className="kline-readout">{readout}</span>
      </div>
      <div
        ref={wrapRef}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          // 命中换算走 chartScale（留白只此一份，不在事件处再写一遍 8/60）。
          const scale = chartScale({ width: rect.width, height: CHART_HEIGHT, bars })
          const idx = scale.indexAt(e.clientX - rect.left)
          setHover(idx >= 0 ? idx : null)
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
