import {
  dslBignumBody,
  dslCardsBody,
  dslCmpBody,
  dslTimelineBody,
  type DslBignumBody,
  type DslCardsBody,
  type DslCmpBody,
  type DslTimelineBody,
} from '@trend-suite/contracts'

/**
 * 容器块 body → 视图模型（arch/06 §2.1 形状，与校验器共用契约里的 schema）：
 * 渲染器只认这里的字段名，服务端复检也用同一份 schema——两边不会各写一套。
 * 纯函数、无 React：可脱离浏览器单测。
 */

export type CardsView = { title: string; desc: string }[]
export type BignumView = { value: string; caption: string }[]
export type CmpView = { title?: string | undefined; left: { head: string; items: string[] }; right: { head: string; items: string[] } }
export type TimelineView = { date: string; title: string; desc: string }[]

export function cardsView(body: string): CardsView | null {
  const parsed = dslCardsBody.safeParse(parseJson(body))
  if (!parsed.success) return null
  return parsed.data.items.map((item: DslCardsBody['items'][number]) => ({
    title: item.num ? `${item.num} · ${item.title}` : item.title,
    desc: item.desc ?? '',
  }))
}

export function bignumView(body: string): BignumView | null {
  const parsed = dslBignumBody.safeParse(parseJson(body))
  if (!parsed.success) return null
  return parsed.data.items.map((item: DslBignumBody['items'][number]) => ({
    value: item.value,
    caption: item.note ? `${item.label} · ${item.note}` : item.label,
  }))
}

export function cmpView(body: string): CmpView | null {
  const parsed = dslCmpBody.safeParse(parseJson(body))
  if (!parsed.success) return null
  return parsed.data
}

export function timelineView(body: string): TimelineView | null {
  const parsed = dslTimelineBody.safeParse(parseJson(body))
  if (!parsed.success) return null
  return parsed.data.events.map((event: DslTimelineBody['events'][number]) => ({
    date: event.date,
    title: event.title,
    desc: event.desc ?? '',
  }))
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
