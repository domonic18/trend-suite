'use client'

import type { AgentMessageView } from '@trend-suite/contracts'
import { TodoCard } from './TodoCard'
import styles from './agent-chat.module.css'

/**
 * 页首常驻 TODO 面板（arch/08 §6，对齐 SasanImmersive TodoPanel 的 details
 * 形态）：渲染线程内最新一份 todo，有进行中项默认展开，全部完成折叠。
 * 消息流内不再渲染 todo。
 */
export function TodoPanel({ todo }: { todo: AgentMessageView | null }) {
  if (!todo || todo.role !== 'todo') return null
  const doing = todo.items.some((item) => item.status === 'doing')
  return (
    <details className={styles.todoPanel} open={doing}>
      <summary>
        <span className={styles.todoSummaryText}>
          {todo.title ?? '任务清单'}
          <small>
            （{todo.items.filter((item) => item.status === 'done').length}/{todo.items.length}）
          </small>
        </span>
      </summary>
      <TodoCard items={todo.items} title={todo.title ?? null} />
    </details>
  )
}
