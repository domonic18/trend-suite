'use client'

import { useEffect, useMemo, useRef } from 'react'
import { dispose, init, type Chart, type KLineData, type Nullable } from 'klinecharts'
import type { KlineBar } from '@trend-suite/contracts'

/** 覆盖线：教学答案趋势线、用户画的线。 */
export type ChartLine = {
  fromIdx: number
  toIdx: number
  price0: number
  price1: number
  color: string
  dashed?: boolean
}

/** 标注点（案例事件 / 学员选择）。 */
export type ChartMarker = {
  idx: number
  label: string
  color: string
  dashed?: boolean
}

/** 区间高亮（答案区间）。 */
export type ChartHighlight = {
  from: number
  to: number
  color: string
}

/**
 * 迷你 K 线（课件里的合成 K 线）：klinecharts 引擎（内置指标/缩放/覆盖层），
 * 与真实行情 KlineChart 同源。props 与旧 canvas 版兼容，消费方零改动。
 *
 * 回放 / 遮蔽语义在**数据层**实现：visibleUpTo / maskFrom 直接裁剪交给图表的
 * K 线数组，未揭示的后市绝不进图表实例（遮罩不是盖在图上，是根本不给）。
 * 主题色从 --k-* token 取（canvas 读不了 var()），工作台切主题时 setStyles。
 */

/** 主题 token → klinecharts Styles。 */
function tokenStyles(): Record<string, unknown> {
  const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback
  const up = read('--k-up', '#d9483f')
  const down = read('--k-down', '#0f9d76')
  const grid = read('--k-grid', 'rgba(22, 32, 58, 0.14)')
  const label = read('--k-label', '#8b94a9')
  return {
    candle: {
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: label,
        upBorderColor: up,
        downBorderColor: down,
        upWickColor: up,
        downWickColor: down,
      },
      priceMark: { show: false },
      tooltip: { showRule: 'follow_cross' },
    },
    indicator: { tooltip: { showRule: 'follow_cross' } },
    grid: {
      horizontal: { show: true, color: grid, size: 1 },
      vertical: { show: false },
    },
    xAxis: { axisLine: { show: false }, tickLine: { show: false }, tickText: { color: label } },
    yAxis: {
      position: 'right',
      axisLine: { show: false },
      tickLine: { show: false },
      tickText: { color: label },
    },
    separator: { size: 1, color: grid, activeBackgroundColor: 'transparent' },
    crosshair: { show: false, horizontal: { show: false }, vertical: { show: false } },
  }
}

function toKLineData(bar: KlineBar, index: number): KLineData {
  const parsed = Date.parse(bar.d)
  return {
    // 合成课件 K 线的日期未必可解析：回退用下标做唯一键（klinecharts 只用 timestamp 排序）
    timestamp: Number.isNaN(parsed) ? index : parsed,
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  }
}

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
  /** 点选回调（画趋势线用）：给的是柱下标。 */
  onPick?: (index: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<Nullable<Chart>>(null)

  /** 回放 / 遮蔽：在数据层裁剪（visibleUpTo 优先，maskFrom 其后）。 */
  const visibleBars = useMemo(() => {
    let list = bars as KlineBar[]
    if (visibleUpTo !== undefined) list = list.slice(0, visibleUpTo + 1)
    if (maskFrom !== undefined) list = list.slice(0, maskFrom)
    return list
  }, [bars, visibleUpTo, maskFrom])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || visibleBars.length === 0) return

    const chart = init(el, {
      locale: 'zh-CN',
      styles: tokenStyles() as never,
    })
    if (!chart) return
    chartRef.current = chart
    chart.setSymbol({ ticker: 'KL', pricePrecision: 2, volumePrecision: 0 })
    chart.setPeriod({ type: 'day', span: 1 })
    chart.setDataLoader({
      getBars: ({ callback }) => callback(visibleBars.map(toKLineData)),
    })

    if (withMa) {
      // 叠加在主图（candle_pane）上
      chart.createIndicator({ name: 'MA', calcParams: [5, 10, 60], paneId: 'candle_pane' }, false)
    }
    // 趋势线（教学答案 / 学员画的线）
    for (const line of lines ?? []) {
      chart.createOverlay({
        name: 'segment',
        points: [
          { dataIndex: line.fromIdx, value: line.price0 },
          { dataIndex: line.toIdx, value: line.price1 },
        ],
        styles: { line: { color: line.color, size: line.dashed ? 1 : 1.5 } },
      })
    }
    // 标注点（案例事件 / 学员选择）
    for (const marker of markers ?? []) {
      chart.createOverlay({
        name: 'simpleAnnotation',
        points: [{ dataIndex: marker.idx }],
        extendData: marker.label,
        styles: { annotation: { color: marker.color } },
      })
    }
    // 区间高亮（答案区间）
    for (const hl of highlights ?? []) {
      chart.createOverlay({
        name: 'rect',
        points: [{ dataIndex: hl.from }, { dataIndex: hl.to }],
        styles: { rect: { color: hl.color, borderColor: hl.color } },
      })
    }
    if (onPick) {
      chart.subscribeAction('onCandleBarClick', (data) => {
        const index = (data as { dataIndex?: number } | undefined)?.dataIndex
        if (index !== undefined) onPick(index)
      })
    }

    // 工作台切主题时按新 token 重设样式
    const themed = el.closest('[data-wb-theme]')
    const themeObserver = new MutationObserver(() => chart.setStyles(tokenStyles() as never))
    if (themed) themeObserver.observe(themed, { attributes: true, attributeFilter: ['data-wb-theme'] })

    return () => {
      themeObserver.disconnect()
      chartRef.current = null
      dispose(el)
    }
  }, [visibleBars, withMa, lines, markers, highlights, onPick])

  return (
    <div className="mini-chart" ref={wrapRef} style={{ height, width: '100%' }} />
  )
}
