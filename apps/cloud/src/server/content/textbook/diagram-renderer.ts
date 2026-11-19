import { z } from 'zod'
import type { DiagramTemplate } from '@trend-suite/contracts'

/**
 * 参数化 SVG 模板渲染器（arch/06 §3）：diagram 图示由服务端确定性出 SVG，
 * 标注文字直出自 params——正确性 100% 由代码保证，Mermaid 不进教材图示通道。
 * 模板白名单 v1：chip-contrast / chip-horizontal / timeline / stat-inline。
 * 纯函数：params 过 schema → 渲 SVG 字符串；不合格抛 zod 错（调用方映射 params_schema_failed）。
 */

export const chipContrastParams = z.object({
  title: z.string().min(1).max(60),
  leftLabel: z.string().min(1).max(20),
  rightLabel: z.string().min(1).max(20),
  leftCount: z.number().int().min(4).max(24),
  rightCount: z.number().int().min(4).max(24),
})

export const chipHorizontalParams = z.object({
  title: z.string().min(1).max(60),
  priceLabel: z.string().max(20).optional().default('价位'),
  rows: z
    .array(
      z.object({
        /** 行位（0=底部，100=顶部）。 */
        y: z.number().int().min(0).max(100),
        /** 行宽占绘图区百分比。 */
        width: z.number().int().min(10).max(100),
        label: z.string().max(20).optional(),
      }),
    )
    .min(2)
    .max(12),
})

export const timelineParams = z.object({
  title: z.string().min(1).max(60),
  events: z
    .array(
      z.object({
        label: z.string().min(1).max(30),
        desc: z.string().max(80).optional(),
      }),
    )
    .min(2)
    .max(8),
})

export const statInlineParams = z.object({
  items: z
    .array(
      z.object({
        label: z.string().min(1).max(20),
        value: z.string().min(1).max(12),
        note: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(4),
})

export const diagramParamsByTemplate: Record<DiagramTemplate, z.ZodTypeAny> = {
  'chip-contrast': chipContrastParams,
  'chip-horizontal': chipHorizontalParams,
  timeline: timelineParams,
  'stat-inline': statInlineParams,
}

export function renderDiagram(template: DiagramTemplate, params: unknown): { svg: string } {
  const parsed = diagramParamsByTemplate[template].parse(params)
  const svg =
    template === 'chip-contrast'
      ? renderChipContrast(parsed as ChipContrastParams)
      : template === 'chip-horizontal'
        ? renderChipHorizontal(parsed as ChipHorizontalParams)
        : template === 'timeline'
          ? renderTimeline(parsed as TimelineParams)
          : renderStatInline(parsed as StatInlineParams)
  return { svg: svg.join('') }
}

type ChipContrastParams = z.infer<typeof chipContrastParams>
type ChipHorizontalParams = z.infer<typeof chipHorizontalParams>
type TimelineParams = z.infer<typeof timelineParams>
type StatInlineParams = z.infer<typeof statInlineParams>

const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#d1d5db'
const ACCENT = '#2563eb'
const ACCENT_SOFT = '#93c5fd'
const WARN = '#b45309'
const WARN_SOFT = '#fcd34d'

function esc(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function header(title: string, width: number): string[] {
  return [
    `<text x="${width / 2}" y="34" text-anchor="middle" font-size="18" font-weight="600" fill="${INK}">`,
    esc(title),
    '</text>',
  ]
}

/** 密集（左，整齐堆叠）vs 发散（右，确定性散布）对比示意。 */
function renderChipContrast(p: ChipContrastParams): string[] {
  const width = 720
  const height = 320
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" role="img">`,
    ...header(p.title, width),
  ]

  // 左半：密集筹码——紧凑行列堆叠。
  const leftCols = 6
  parts.push(`<text x="180" y="78" text-anchor="middle" font-size="14" fill="${MUTED}">${esc(p.leftLabel)}</text>`)
  for (let i = 0; i < p.leftCount; i += 1) {
    const col = i % leftCols
    const row = Math.floor(i / leftCols)
    const x = 60 + col * 40
    const y = 100 + row * 22
    parts.push(`<rect x="${x}" y="${y}" width="34" height="16" rx="3" fill="${ACCENT_SOFT}" stroke="${ACCENT}"/>`)
  }

  // 右半：发散筹码——按索引的确定性散布（不用随机数，重渲结果一致）。
  parts.push(`<text x="540" y="78" text-anchor="middle" font-size="14" fill="${MUTED}">${esc(p.rightLabel)}</text>`)
  for (let i = 0; i < p.rightCount; i += 1) {
    const x = 420 + ((i * 97) % 240)
    const y = 96 + ((i * 53) % 180)
    const size = 20 + ((i * 31) % 18)
    parts.push(`<rect x="${x}" y="${y}" width="${size}" height="${size * 0.5}" rx="3" fill="${WARN_SOFT}" stroke="${WARN}"/>`)
  }

  parts.push(`<line x1="360" y1="70" x2="360" y2="290" stroke="${LINE}" stroke-dasharray="4 4"/>`)
  parts.push('</svg>')
  return parts
}

/** 横线筹码示意：每行一条水平筹码带，宽度即占比。 */
function renderChipHorizontal(p: ChipHorizontalParams): string[] {
  const width = 720
  const height = 320
  const plotLeft = 90
  const plotRight = width - 60
  const plotTop = 70
  const plotBottom = height - 50
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" role="img">`,
    ...header(p.title, width),
  ]

  const rows = [...p.rows].sort((a, b) => a.y - b.y)
  const gap = (plotBottom - plotTop) / (rows.length + 1)
  rows.forEach((row, index) => {
    const y = plotBottom - gap * (index + 1)
    const barWidth = ((plotRight - plotLeft) * row.width) / 100
    parts.push(`<rect x="${plotLeft}" y="${y - 8}" width="${barWidth}" height="16" rx="4" fill="${ACCENT_SOFT}" stroke="${ACCENT}"/>`)
    if (row.label) {
      parts.push(`<text x="${plotLeft + barWidth + 10}" y="${y + 5}" font-size="12" fill="${MUTED}">${esc(row.label)}</text>`)
    }
  })

  parts.push(`<line x1="${plotLeft}" y1="${plotTop - 10}" x2="${plotLeft}" y2="${plotBottom + 10}" stroke="${LINE}"/>`)
  parts.push(`<text x="${plotLeft - 10}" y="${plotTop - 14}" text-anchor="end" font-size="12" fill="${MUTED}">${esc(p.priceLabel)}</text>`)
  parts.push('</svg>')
  return parts
}

/** 水平时间轴：主轴 + 均布事件点，标签上下交替。 */
function renderTimeline(p: TimelineParams): string[] {
  const width = 720
  const height = 240
  const axisY = height / 2 + 10
  const pad = 60
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" role="img">`,
    ...header(p.title, width),
    `<line x1="${pad - 20}" y1="${axisY}" x2="${width - pad + 20}" y2="${axisY}" stroke="${LINE}" stroke-width="2"/>`,
  ]

  const step = (width - pad * 2) / (p.events.length - 1 || 1)
  p.events.forEach((event, index) => {
    const x = pad + step * index
    const above = index % 2 === 0
    const labelY = above ? axisY - 46 : axisY + 46
    const descY = above ? axisY - 26 : axisY + 66
    parts.push(`<circle cx="${x}" cy="${axisY}" r="6" fill="${ACCENT}"/>`)
    parts.push(`<line x1="${x}" y1="${axisY}" x2="${x}" y2="${above ? axisY - 18 : axisY + 18}" stroke="${LINE}"/>`)
    parts.push(`<text x="${x}" y="${labelY}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">${esc(event.label)}</text>`)
    if (event.desc) {
      parts.push(`<text x="${x}" y="${descY}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(event.desc)}</text>`)
    }
  })

  parts.push('</svg>')
  return parts
}

/** 大数字卡内嵌迷你图：1~4 个关键数字并排。 */
function renderStatInline(p: StatInlineParams): string[] {
  const width = 720
  const height = 180
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif" role="img">`,
  ]

  const cardWidth = (width - 40 * (p.items.length + 1)) / p.items.length
  p.items.forEach((item, index) => {
    const x = 40 + (cardWidth + 40) * index
    const valueY = 92
    parts.push(
      `<rect x="${x}" y="36" width="${cardWidth}" height="108" rx="10" fill="#f8fafc" stroke="${LINE}"/>`,
      `<text x="${x + cardWidth / 2}" y="58" text-anchor="middle" font-size="13" fill="${MUTED}">${esc(item.label)}</text>`,
      `<text x="${x + cardWidth / 2}" y="${valueY}" text-anchor="middle" font-size="30" font-weight="700" fill="${INK}">${esc(item.value)}</text>`,
    )
    if (item.note) {
      parts.push(`<text x="${x + cardWidth / 2}" y="124" text-anchor="middle" font-size="12" fill="${MUTED}">${esc(item.note)}</text>`)
    }
  })

  parts.push('</svg>')
  return parts
}
