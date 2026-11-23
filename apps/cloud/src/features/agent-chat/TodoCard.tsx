'use client'

import type { AgentTodoItem } from '@trend-suite/contracts'

/** Agent TODO 卡（原型 .planw）：pending / doing / done 三态清单，始终渲染最新一份。 */
export function TodoCard({ items, title = null }: { items: AgentTodoItem[]; title?: string | null }) {
  const done = items.filter((item) => item.status === 'done').length
  return (
    <div className="planw">
      <div className="ph">
        {title ?? '任务清单'} <span className="n">{done}/{items.length}</span>
      </div>
      {items.map((item, index) => (
        <div
          key={index}
          className={item.status === 'done' ? 'pw-item done' : item.status === 'doing' ? 'pw-item doing' : 'pw-item'}
        >
          <span className="tick">{item.status === 'done' ? '✓' : ''}</span>
          <span>{item.content}</span>
        </div>
      ))}
    </div>
  )
}
