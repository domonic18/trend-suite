/**
 * klinecharts 主题样式单一真相：--k-* / --p-* token → klinecharts Styles
 * 的映射（canvas 读不了 CSS 变量，经 getComputedStyle 取值）。此前
 * KlineChart 与 MiniChart 各写一份，主题色调整会改一处漏一处。
 *
 * 工作台切主题（data-wb-theme 变化）由各组件的 MutationObserver 调
 * chart.setStyles(tokenStyles()) 重设。
 */
export function klineTokenStyles(): Record<string, unknown> {
  const style =
    typeof window === 'undefined' ? null : getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    style?.getPropertyValue(name).trim() || fallback
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
      tooltip: { showRule: 'follow_cross', rect: { padding: 4, margin: 6, borderRadius: 6 } },
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
    crosshair: {
      show: true,
      horizontal: { line: { show: true, color: label } },
      vertical: { line: { show: true, color: label } },
    },
  }
}

/** 讀 token 的简单包装（竖线标注等局部取色用）。 */
export function readKlineToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}
