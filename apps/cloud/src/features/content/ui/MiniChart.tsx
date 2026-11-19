'use client'

import { useEffect, useRef } from 'react'
import type { KlineBar } from '@trend-suite/contracts'
import {
  chartScale,
  drawChart,
  sma,
  type ChartHighlight,
  type ChartLine,
  type ChartMarker,
} from '@/features/lib/chartDraw'

/**
 * 迷你 K 线（课件里的合成 K 线）：与真实行情的 K 线组件共用 chartDraw 的绘制
 * 内核——同一份画法，课件与真实行情才谈得上同源。
 */

export function MiniChart({
  bars,
  height = 130,
  withMa = false,
  lines,
  markers,
  highlights,
  visibleUpTo,
  maskFrom,
  onPick,
}: {
  bars: readonly KlineBar[]
  height?: number
  withMa?: boolean
  lines?: ChartLine[]
  markers?: ChartMarker[]
  highlights?: ChartHighlight[]
  visibleUpTo?: number
  maskFrom?: number
  /** 点选回调（画趋势线用）：给的是柱下标与该处的价格。 */
  onPick?: (index: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const draw = () => {
      const width = wrap.clientWidth
      if (width === 0) return
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
        ...(withMa ? { ma: { 5: sma(bars, 5), 10: sma(bars, 10), 60: sma(bars, 60) } } : {}),
        ...(lines ? { lines } : {}),
        ...(markers ? { markers } : {}),
        ...(highlights ? { highlights } : {}),
        ...(visibleUpTo !== undefined ? { visibleUpTo } : {}),
        ...(maskFrom !== undefined ? { maskFrom } : {}),
      })
    }
    draw()
    const observer = new ResizeObserver(() => draw())
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [bars, height, withMa, lines, markers, highlights, visibleUpTo, maskFrom])

  return (
    <div
      className="mini-chart"
      ref={wrapRef}
      onClick={(event) => {
        if (!onPick) return
        const rect = event.currentTarget.getBoundingClientRect()
        // 命中换算走 chartScale（留白只此一份，不在点击处再写一遍 8/60）。
        const scale = chartScale({ width: rect.width, height, bars })
        const index = scale.indexAt(event.clientX - rect.left)
        if (index >= 0) onPick(index)
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  )
}
