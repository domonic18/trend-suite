import type { AgentMessageView } from '@trend-suite/contracts'

/**
 * 渲染前折叠（arch/08 §6）：todo 由页首 TodoPanel 承载不进流；连续系统事件
 * 归组——单条直出，多条折叠成可展开组（含 err 的组默认展开，失败不静默）。
 */
export type ChatItem =
  | { kind: 'message'; message: AgentMessageView }
  | { kind: 'events'; events: AgentMessageView[]; hasErr: boolean }

export function foldChatItems(messages: AgentMessageView[]): ChatItem[] {
  const items: ChatItem[] = []
  let buffer: AgentMessageView[] = []
  const flush = () => {
    if (buffer.length === 0) return
    items.push({
      kind: 'events',
      events: buffer,
      hasErr: buffer.some((m) => m.role === 'event' && m.level === 'err'),
    })
    buffer = []
  }
  for (const message of messages) {
    if (message.role === 'todo') continue // TodoPanel 渲染最新一份；不打断事件组（todo 与 event 交错是常态）
    if (message.role === 'event') {
      buffer.push(message)
      continue
    }
    flush()
    items.push({ kind: 'message', message })
  }
  flush()
  return items
}

/** 线程内最新一份 todo（TodoPanel 用）。 */
export function latestTodo(messages: AgentMessageView[]): AgentMessageView | null {
  let found: AgentMessageView | null = null
  for (const message of messages) {
    if (message.role === 'todo') found = message
  }
  return found
}
