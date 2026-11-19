import type { KlineBar } from '@trend-suite/contracts'

/**
 * 教学 K 线的绘制内核（arch/06 §5.3）：真实行情的 K 线组件与课件里的合成 K 线
 * 共用这一份——**同一份画法**才谈得上「课件与真实行情同源」。
 *
 * 绘制与命中换算共用一份刻度（chartScale）：padL/padR 等留白只此一份，
 * 迭代 6 的教训——同一个常量在两处各写一遍，迟早对不上（悬停读数指错根）。
 */

export const CHART_UP = '#d9483f'
export const CHART_DOWN = '#0f9d76'

/** 均线白名单与固定配色（arch/06 §5.3）。 */
export const MA_PERIODS = [
  { n: 5, color: '#c47a12' },
  { n: 10, color: '#2563eb' },
  { n: 60, color: '#8b94a9' },
] as const

/** 画布留白（价格轴占右侧、日期轴占底部、成交量面板在下）。 */
export const CHART_PAD = { l: 8, r: 60, t: 10, axisH: 20, volH: 56 } as const

/** 迷你图（课件里的合成 K 线）画布矮：成交量与日期轴按比例收缩，别把价格区挤没。 */
function panelHeights(height: number): { axisH: number; volH: number } {
  return {
    axisH: Math.min(CHART_PAD.axisH, Math.max(0, height * 0.16)),
    volH: Math.min(CHART_PAD.volH, Math.max(0, height * 0.28)),
  }
}

export function sma(bars: readonly KlineBar[], n: number): (number | null)[] {
  return bars.map((_, i) => {
    if (i < n - 1) return null
    let sum = 0
    for (let k = i - n + 1; k <= i; k += 1) sum += bars[k]?.c ?? 0
    return sum / n
  })
}

/** 刻度：绘制与交互（点选、命中）共用。 */
export type ChartScale = {
  minPrice: number
  maxPrice: number
  priceH: number
  volH: number
  axisH: number
  plotW: number
  slot: number
  bodyW: number
  yPrice: (price: number) => number
  priceAt: (y: number) => number
  yVol: (volume: number) => number
  xMid: (index: number) => number
  indexAt: (x: number) => number
}

export type ChartScaleInput = {
  width: number
  height: number
  bars: readonly KlineBar[]
  ma?: Record<number, (number | null)[]>
}

export function chartScale(input: ChartScaleInput): ChartScale {
  const { width, height, bars } = input
  const { axisH, volH } = panelHeights(height)
  const priceH = height - CHART_PAD.t - axisH - volH - 6
  const plotW = width - CHART_PAD.l - CHART_PAD.r
  const slot = plotW / Math.max(1, bars.length)
  const bodyW = Math.max(1.5, Math.min(11, slot * 0.62))
  const maNums = (input.ma ?? {})
  const values = Object.values(maNums).flatMap((series) => series.filter((v): v is number => v !== null))
  const highs = bars.map((bar) => bar.h)
  const lows = bars.map((bar) => bar.l)
  const maxPrice = Math.max(...highs, ...values)
  const minPrice = Math.min(...lows, ...values)
  const span = maxPrice - minPrice || 1
  const maxVol = Math.max(...bars.map((bar) => bar.v)) || 1
  const yPrice = (price: number) =>
    CHART_PAD.t + ((maxPrice - price) / span) * 0.96 * priceH + priceH * 0.02
  return {
    minPrice,
    maxPrice,
    priceH,
    volH,
    axisH,
    plotW,
    slot,
    bodyW,
    yPrice,
    priceAt: (y: number) => {
      const ratio = (y - CHART_PAD.t - priceH * 0.02) / (0.96 * priceH)
      return maxPrice - ratio * span
    },
    yVol: (volume: number) => CHART_PAD.t + priceH + (volH - (volume / maxVol) * volH) + 6,
    xMid: (index: number) => CHART_PAD.l + slot * (index + 0.5),
    indexAt: (x: number) => {
      const index = Math.floor((x - CHART_PAD.l) / slot)
      return index >= 0 && index < bars.length ? index : -1
    },
  }
}

/** 事件锚点（案例事件 → 柱下标；取窗口内 ≤ 该日的最后交易日）。 */
export function anchorIndexes(
  bars: readonly KlineBar[],
  anchors: readonly { date: string }[],
): number[] {
  return anchors.map((anchor) => {
    let idx = -1
    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i]!
      if (bar.d <= anchor.date) idx = i
      else break
    }
    return idx
  })
}

export type ChartMarker = {
  idx: number
  label: string
  color: string
  dashed?: boolean
}

export type ChartHighlight = {
  from: number
  to: number
  color: string
}

/** 覆盖线：教学答案趋势线、用户画的线。 */
export type ChartLine = {
  fromIdx: number
  toIdx: number
  price0: number
  price1: number
  color: string
  dashed?: boolean
}

export type ChartDrawOptions = {
  width: number
  height: number
  bars: readonly KlineBar[]
  ma?: Record<number, (number | null)[]>
  /** 竖线锚点（案例事件、素材单元）。 */
  anchors?: { idx: number; label: string }[]
  markers?: ChartMarker[]
  highlights?: ChartHighlight[]
  lines?: ChartLine[]
  /** 只画前 N 根（逐根回放：未揭示的部分不画，绝不预示后市）。 */
  visibleUpTo?: number
  /** 未揭示区遮罩起点（根下标）：从这根起盖住，学员看不到后市。 */
  maskFrom?: number
  /** 画布底色（回放遮罩用）。 */
  background?: string
}

export function drawChart(ctx: CanvasRenderingContext2D, opts: ChartDrawOptions): void {
  const { width, height } = opts
  const all = opts.bars
  const visible = opts.visibleUpTo ?? all.length
  const bars = all.slice(0, visible)
  ctx.clearRect(0, 0, width, height)
  if (bars.length === 0) return

  const ma = opts.ma
  // 刻度按**全部** K 线定标：逐根揭示时纵轴不跳（arch/06 §10「纵轴全区间定标防跳动」），
  // 横轴槽位也按全长算，已揭示的柱子不会随着推进而挪位。
  const scale = chartScale({ width, height, bars: all, ...(ma ? { ma } : {}) })
  const { yPrice, yVol, xMid, bodyW } = scale
  const volBottom = CHART_PAD.t + scale.priceH + scale.volH + 6

  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, width, height)
  }

  ctx.font = '11px system-ui, sans-serif'

  // 高亮区间（回放遮罩前的已揭示段 / 步骤窗口）
  for (const highlight of opts.highlights ?? []) {
    const from = Math.max(0, Math.min(highlight.from, bars.length - 1))
    const to = Math.max(0, Math.min(highlight.to, bars.length - 1))
    if (to < from) continue
    ctx.fillStyle = highlight.color
    ctx.fillRect(xMid(from) - bodyW, CHART_PAD.t, xMid(to) - xMid(from) + bodyW, volBottom - CHART_PAD.t)
  }

  // 网格 + 价格轴（标签密度随价格区高度收敛——迷你图上挤成一团反而读不出数）
  ctx.strokeStyle = 'rgba(228,233,242,0.7)'
  ctx.fillStyle = '#8b94a9'
  ctx.textAlign = 'left'
  const gridSteps = scale.priceH >= 140 ? 4 : scale.priceH >= 70 ? 2 : scale.priceH >= 30 ? 1 : 0
  for (let g = 0; gridSteps > 0 && g <= gridSteps; g += 1) {
    const price = scale.minPrice + ((scale.maxPrice - scale.minPrice) * g) / gridSteps
    const y = yPrice(price)
    ctx.beginPath()
    ctx.moveTo(CHART_PAD.l, y)
    ctx.lineTo(CHART_PAD.l + scale.plotW, y)
    ctx.stroke()
    ctx.fillText(price.toFixed(2), CHART_PAD.l + scale.plotW + 6, y + 4)
  }

  // 蜡烛 + 成交量
  bars.forEach((bar, i) => {
    const color = bar.c >= bar.o ? CHART_UP : CHART_DOWN
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
    ctx.fillRect(x - bodyW / 2, yVol(bar.v), bodyW, volBottom - yVol(bar.v))
    ctx.globalAlpha = 1
  })

  // 均线
  for (const { n, color } of MA_PERIODS) {
    const series = ma?.[n]
    if (!series) continue
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2
    ctx.beginPath()
    let started = false
    series.forEach((value, i) => {
      if (value === null || i >= bars.length) return
      const x = xMid(i)
      const y = yPrice(value)
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

  // 覆盖线（趋势线）
  for (const line of opts.lines ?? []) {
    ctx.strokeStyle = line.color
    ctx.lineWidth = 1.6
    if (line.dashed) ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(xMid(line.fromIdx), yPrice(line.price0))
    ctx.lineTo(xMid(line.toIdx), yPrice(line.price1))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.lineWidth = 1
  }

  // 竖线锚点
  ;(opts.anchors ?? []).forEach((anchor, seq) => {
    if (anchor.idx < 0 || anchor.idx >= bars.length) return
    const x = xMid(anchor.idx)
    ctx.strokeStyle = 'rgba(37,99,235,0.65)'
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(x, CHART_PAD.t)
    ctx.lineTo(x, volBottom)
    ctx.stroke()
    ctx.setLineDash([])
    const label = anchor.label.length > 8 ? `${anchor.label.slice(0, 7)}…` : anchor.label
    const ty = CHART_PAD.t + 2 + (seq % 2) * 14
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(37,99,235,0.12)'
    ctx.fillRect(x + 2, ty - 2, tw + 8, 14)
    ctx.fillStyle = '#2563eb'
    ctx.textAlign = 'left'
    ctx.fillText(label, x + 6, ty + 9)
  })

  // 判断点标记（实心三角 + 标签；标签压在三角上方，别掉到画布外）
  for (const marker of opts.markers ?? []) {
    if (marker.idx < 0 || marker.idx >= bars.length) continue
    const x = xMid(marker.idx)
    const y = Math.min(volBottom + 8, height - 6)
    ctx.fillStyle = marker.color
    ctx.beginPath()
    ctx.moveTo(x, y - 8)
    ctx.lineTo(x - 5, y)
    ctx.lineTo(x + 5, y)
    ctx.closePath()
    ctx.fill()
    if (marker.label) {
      ctx.fillStyle = marker.color
      ctx.textAlign = 'center'
      ctx.fillText(marker.label, x, Math.max(12, y - 11))
    }
  }

  // 未揭示区遮罩（逐根回放）：盖住未来，只留价格轴（全区间定标）。
  if (opts.maskFrom !== undefined && opts.maskFrom < all.length) {
    const x = xMid(opts.maskFrom)
    ctx.fillStyle = 'rgba(247,249,252,0.92)'
    ctx.fillRect(x - bodyW, 0, CHART_PAD.l + scale.plotW - x + bodyW, height)
    ctx.fillStyle = '#8b94a9'
    ctx.textAlign = 'center'
    ctx.fillText('未揭示', Math.min(width - 40, x + 40), CHART_PAD.t + 12)
  }

  // 日期轴（首/中/尾）：按**全部** K 线取刻度，未揭示的不画——
  // 否则逐根推进时刻度挤在左缘，日期叠成一团。
  ctx.fillStyle = '#8b94a9'
  ctx.textAlign = 'center'
  const ticks = [0, Math.floor(all.length / 2), all.length - 1]
  for (const i of ticks) {
    const bar = bars[i]
    if (bar) ctx.fillText(bar.d, xMid(i), height - 6)
  }
}
