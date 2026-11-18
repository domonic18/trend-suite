'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KlineBar, StockQuotesView } from '@trend-suite/contracts'

/**
 * 教学 K 线（教师预览版，移植原型 student-course.html 的 #kchart 形态）：
 * 蜡烛 + 成交量 + MA5/10/60（白名单内）+ 事件锚点竖线；行情不可用画占位框，
 * 绝不编造数值。悬停读数用于「数值可核」（验收①）。
 */

const UP_COLOR = '#d9483f'
const DOWN_COLOR = '#0f9d76'
const MA_COLORS: { n: number; color: string }[] = [
  { n: 5, color: '#c47a12' },
  { n: 10, color: '#2563eb' },
  { n: 60, color: '#8b94a9' },
]

function sma(bars: KlineBar[], n: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let k = i - n + 1; k <= i; k++) sum += bars[k]?.c ?? 0
    return sum / n
  })
}

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
      const height = 320
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)

      const padL = 8
      const padR = 60
      const padT = 10
      const axisH = 20
      const volH = 56
      const priceH = height - padT - axisH - volH - 6
      const plotW = width - padL - padR
      const slot = plotW / bars.length
      const bodyW = Math.max(1.5, Math.min(11, slot * 0.62))

      const highs = bars.map((b) => b.h)
      const lows = bars.map((b) => b.l)
      const maNums = MA_COLORS.flatMap(({ n }) => (ma[n] ?? []).filter((v): v is number => v !== null))
      const maxPrice = Math.max(...highs, ...maNums)
      const minPrice = Math.min(...lows, ...maNums)
      const span = maxPrice - minPrice || 1
      const yPrice = (p: number) => padT + ((maxPrice - p) / span) * 0.96 * priceH + priceH * 0.02
      const maxVol = Math.max(...bars.map((b) => b.v)) || 1
      const yVol = (v: number) => padT + priceH + axisH * 0 + (volH - (v / maxVol) * volH) + 6
      const xMid = (i: number) => padL + slot * (i + 0.5)

      ctx.clearRect(0, 0, width, height)
      ctx.font = '11px system-ui, sans-serif'

      // 网格 + 价格轴
      ctx.strokeStyle = 'rgba(228,233,242,0.7)'
      ctx.fillStyle = '#8b94a9'
      ctx.textAlign = 'left'
      for (let g = 0; g <= 4; g++) {
        const p = minPrice + (span * g) / 4
        const y = yPrice(p)
        ctx.beginPath()
        ctx.moveTo(padL, y)
        ctx.lineTo(padL + plotW, y)
        ctx.stroke()
        ctx.fillText(fmt(p), padL + plotW + 6, y + 4)
      }

      // 蜡烛 + 成交量
      bars.forEach((bar, i) => {
        const up = bar.c >= bar.o
        const color = up ? UP_COLOR : DOWN_COLOR
        const x = xMid(i)
        ctx.strokeStyle = color
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(x, yPrice(bar.h))
        ctx.lineTo(x, yPrice(bar.l))
        ctx.stroke()
        const yO = yPrice(bar.o)
        const yC = yPrice(bar.c)
        const top = Math.min(yO, yC)
        const h = Math.max(1, Math.abs(yC - yO))
        ctx.fillRect(x - bodyW / 2, top, bodyW, h)
        ctx.globalAlpha = 0.55
        ctx.fillRect(x - bodyW / 2, yVol(bar.v), bodyW, padT + priceH + volH + 6 - yVol(bar.v))
        ctx.globalAlpha = 1
      })

      // 均线
      for (const { n, color } of MA_COLORS) {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.2
        ctx.beginPath()
        let started = false
        ;(ma[n] ?? []).forEach((v, i) => {
          if (v === null) return
          const x = xMid(i)
          const y = yPrice(v)
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else {
            ctx.lineTo(x, y)
          }
        })
        ctx.stroke()
        ctx.lineWidth = 1
      }

      // 事件锚点：竖线 + 顶部标签（隔行错开减少重叠）
      anchorIndex.forEach(({ anchor, idx }, seq) => {
        if (idx < 0) return
        const x = xMid(idx)
        ctx.strokeStyle = 'rgba(37,99,235,0.65)'
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, padT + priceH + volH + 6)
        ctx.stroke()
        ctx.setLineDash([])
        const label = anchor.label.length > 8 ? `${anchor.label.slice(0, 7)}…` : anchor.label
        const ty = padT + 2 + (seq % 2) * 14
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(37,99,235,0.12)'
        ctx.fillRect(x + 2, ty - 2, tw + 8, 14)
        ctx.fillStyle = '#2563eb'
        ctx.textAlign = 'left'
        ctx.fillText(label, x + 6, ty + 9)
      })

      // 日期轴（首/中/尾）
      ctx.fillStyle = '#8b94a9'
      ctx.textAlign = 'center'
      const ticks = [0, Math.floor(bars.length / 2), bars.length - 1]
      ticks.forEach((i) => {
        const bar = bars[i]
        if (bar) ctx.fillText(bar.d, xMid(i), height - 6)
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
        {MA_COLORS.map(({ n, color }) => (
          <span key={n}>
            <i style={{ background: color }} />
            MA{n}
          </span>
        ))}
        <span>
          <i style={{ background: UP_COLOR }} />
          涨
        </span>
        <span>
          <i style={{ background: DOWN_COLOR }} />
          跌
        </span>
        <span className="kline-readout">{readout}</span>
      </div>
      <div
        ref={wrapRef}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const slot = (rect.width - 8 - 60) / bars.length
          const idx = Math.floor((e.clientX - rect.left - 8) / slot)
          setHover(idx >= 0 && idx < bars.length ? idx : null)
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
