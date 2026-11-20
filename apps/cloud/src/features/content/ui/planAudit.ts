import type { PlanLessonEvidenceView } from '@trend-suite/contracts'

/**
 * 出处摘要（呈现层）：教师要一眼看到「这一课真的出自我的视频哪几分钟、讲了哪些点」。
 *
 * 纯函数——出处怎么排版属于口径，得能单测，不能散在组件里。
 */

/** 时间码：毫秒 → mm:ss（不足一小时）或 h:mm:ss。 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 一条出处：素材名 + 时间码 + 讲解要点。 */
export function evidenceLineOf(evidence: PlanLessonEvidenceView): string {
  const range = `${formatClock(evidence.startMs)}–${formatClock(evidence.endMs)}`
  const points = evidence.points.filter((point) => point.trim().length > 0)
  const head = `${evidence.assetName} ${range}`
  if (points.length === 0) return head
  const shown = points.slice(0, 3).join('；')
  const rest = points.length > 3 ? `；…另 ${points.length - 3} 条` : ''
  return `${head} · ${shown}${rest}`
}

/**
 * 摘要行：同一素材的多个片段合成一条时间范围，多个素材并列。
 * 没有出处时返回 null（不要显示成「无出处」三个字，页面自己会处理空态）。
 */
export function evidenceSummaryOf(evidence: PlanLessonEvidenceView[]): string | null {
  if (evidence.length === 0) return null
  const byAsset = new Map<string, { start: number; end: number }>()
  for (const item of evidence) {
    const bound = byAsset.get(item.assetName)
    if (!bound) {
      byAsset.set(item.assetName, { start: item.startMs, end: item.endMs })
      continue
    }
    bound.start = Math.min(bound.start, item.startMs)
    bound.end = Math.max(bound.end, item.endMs)
  }
  return [...byAsset.entries()]
    .map(([name, bound]) => `${name} ${formatClock(bound.start)}–${formatClock(bound.end)}`)
    .join('；')
}

/** 明细行：每条出处一行，教师逐条核对要点。 */
export function evidenceDetailLinesOf(evidence: PlanLessonEvidenceView[]): string[] {
  return evidence.map((item) => evidenceLineOf(item))
}
