'use client'

import type { AgentTodoItem } from '@trend-suite/contracts'

/**
 * Agent TODO 卡——主流任务清单形态（Claude Code / Linear task list）：
 * 勾选框三态（完成=绿底白勾+删除线置灰；进行中=旋转环+高亮+「进行中」徽标；
 * 待办=空心框置灰），头部计数与进度条。对话流中始终渲染最新一份。
 */
export function TodoCard({ items, title = null }: { items: AgentTodoItem[]; title?: string | null }) {
  const done = items.filter((item) => item.status === 'done').length
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0
  return (
    <div className="atodo">
      <div className="atodo-h">
        <svg className="atodo-ic" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 3.5h11M2.5 8h11M2.5 12.5h7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <b>{title ?? '任务清单'}</b>
        <span className="grow" />
        <span className="atodo-n">
          {done}/{items.length}
        </span>
      </div>
      <div
        className="atodo-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="任务完成进度"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <ul className="atodo-list">
        {items.map((item, index) => (
          <li key={index} className={`atodo-i ${item.status}`}>
            <span className="atodo-box" aria-hidden="true">
              {item.status === 'done' ? (
                <svg viewBox="0 0 12 12">
                  <path
                    d="M2.5 6.5l2.5 2.5 4.5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : item.status === 'doing' ? (
                <span className="atodo-spin" />
              ) : null}
            </span>
            <span className="atodo-txt">{item.content}</span>
            {item.status === 'doing' ? <span className="atodo-run">进行中</span> : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
