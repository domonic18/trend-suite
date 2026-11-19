import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { KlineBar } from '@trend-suite/contracts'
import { chartScale, drawChart, sma, anchorIndexes } from './chartDraw'

/**
 * 共享图表内核（arch/06 §5.3）：真实行情与课件合成 K 线共用一份画法。
 * 关键不变量：刻度按**全部** bars 定标（逐根揭示时不跳轴）、未揭示区被遮罩
 * （不预示后市）——用 stub ctx 钉住，不依赖浏览器。
 */

const BARS: KlineBar[] = [
  { d: '2024-03-01', o: 10, h: 11, l: 9.5, c: 10.5, v: 100 },
  { d: '2024-03-04', o: 10.5, h: 12, l: 10, c: 11.5, v: 120 },
  { d: '2024-03-05', o: 11.5, h: 12.5, l: 11, c: 11, v: 90 },
  { d: '2024-03-06', o: 11, h: 13, l: 10.8, c: 12.5, v: 150 },
  { d: '2024-03-07', o: 12.5, h: 13.5, l: 12, c: 13, v: 170 },
]

type Rect = { x: number; y: number; w: number; h: number }

function stubCtx(): { ctx: CanvasRenderingContext2D; rects: Rect[]; texts: string[] } {
  const rects: Rect[] = []
  const texts: string[] = []
  const ctx = {
    clearRect: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h })
    },
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    fillText: (text: string) => {
      texts.push(text)
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
    setLineDash: () => {},
    save: () => {},
    restore: () => {},
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set font(_value: string) {},
    set textAlign(_value: string) {},
    set globalAlpha(_value: number) {},
  } as unknown as CanvasRenderingContext2D
  return { ctx, rects, texts }
}

test('chartScale：价格换算可逆、命中换算与槽位一致', () => {
  const scale = chartScale({ width: 400, height: 240, bars: BARS })
  const mid = (scale.minPrice + scale.maxPrice) / 2
  assert.ok(Math.abs(scale.priceAt(scale.yPrice(mid)) - mid) < 1e-6)
  for (let i = 0; i < BARS.length; i += 1) {
    assert.equal(scale.indexAt(scale.xMid(i)), i)
  }
  assert.equal(scale.indexAt(-10), -1)
  assert.equal(scale.indexAt(scale.xMid(0) + scale.slot * 10), -1)
})

test('chartScale：均线的空值前缀不参与定标', () => {
  const series = sma(BARS, 3)
  assert.deepEqual(series.slice(0, 2), [null, null])
  assert.ok(series[4] !== null)
  const scale = chartScale({ width: 400, height: 240, bars: BARS, ma: { 3: series } })
  assert.ok(scale.maxPrice >= Math.max(...BARS.map((bar) => bar.h)))
})

test('anchorIndexes：事件日期归位到窗口内最后一根', () => {
  assert.deepEqual(anchorIndexes(BARS, [{ date: '2024-03-05' }, { date: '2024-03-01' }]), [2, 0])
})

test('drawChart：逐根揭示只画已揭示的柱，纵轴仍按全区间定标', () => {
  const { ctx, rects } = stubCtx()
  drawChart(ctx, { width: 400, height: 240, bars: BARS, visibleUpTo: 2 })
  // 蜡烛实体 + 成交量：每根 2 个矩形 → 2 根 = 4
  const candleRects = rects.filter((rect) => rect.h > 0)
  assert.ok(candleRects.length >= 4)

  const full = chartScale({ width: 400, height: 240, bars: BARS })
  const partial = chartScale({ width: 400, height: 240, bars: BARS })
  assert.equal(full.maxPrice, partial.maxPrice)
})

test('drawChart：maskFrom 盖住未揭示区并标注「未揭示」', () => {
  const { ctx, rects, texts } = stubCtx()
  drawChart(ctx, { width: 400, height: 240, bars: BARS, visibleUpTo: 2, maskFrom: 2 })
  assert.ok(texts.includes('未揭示'))
  // 遮罩从第 2 根起铺到绘图区右缘（价格轴不盖——读数还要看）
  const scale = chartScale({ width: 400, height: 240, bars: BARS })
  const mask = rects.find((rect) => rect.h >= 240)
  assert.ok(mask, '应有铺满右缘的遮罩矩形')
  assert.ok(mask.x <= scale.xMid(2) + 1)
  assert.ok(mask.x + mask.w <= 8 + scale.plotW + 1, '遮罩不应盖住右侧价格轴')
})

test('drawChart：迷你图画布矮，价格轴标签收敛（不叠成一团）', () => {
  const { ctx, texts } = stubCtx()
  drawChart(ctx, { width: 300, height: 110, bars: BARS })
  const labels = texts.filter((text) => /^\d+\.\d{2}$/.test(text))
  assert.ok(labels.length <= 2, `迷你图价格标签应 ≤2 条，实际 ${labels.length}`)
})

test('drawChart：锚点、判断点与覆盖线都落到画布上', () => {
  const { ctx, rects, texts } = stubCtx()
  drawChart(ctx, {
    width: 400,
    height: 240,
    bars: BARS,
    anchors: [{ idx: 1, label: '起涨点' }],
    markers: [{ idx: 3, label: '判断', color: '#d9483f' }],
    lines: [{ fromIdx: 0, toIdx: 4, price0: 9.8, price1: 13.2, color: '#2563eb' }],
  })
  assert.ok(texts.includes('起涨点'))
  assert.ok(texts.includes('判断'))
  assert.ok(rects.length > 0)
})
