'use client'

import { useState } from 'react'
import type { AgentToolEventView } from '@trend-suite/contracts'
import { describeGroup, groupTools, isReadTool, toolLabel, type ToolGroup } from './toolActivity'
import styles from './agent-chat.module.css'

/**
 * 工具调用折叠行（arch/08 §6，对齐 SasanImmersive ToolRow）：一行中文摘要
 * （图标 + 动作 + 次数/耗时），点击展开每次调用的明细（工具名 + 参数摘要 +
 * 状态）。连续读操作聚合为一行——对话流不出现裸工具名。
 */

/** 图标：读=文件夹、校验=对勾、写=文档（Sasan 同款语义）。 */
function glyphOf(tool: string): string {
  if (isReadTool(tool)) return 'M2 4h4l2 2h6v7H2z'
  if (tool === 'apply_tweak' || tool === 'draft_plan' || tool === 'revise_plan')
    return 'M3 8l3 3 7-7'
  return 'M4 2h6l3 3v9H4z M9 2v4h4 M6 9h5 M6 11h4'
}

function GroupRow({ group }: { group: ToolGroup }) {
  const [open, setOpen] = useState(false)
  const { label, detail } = describeGroup(group)
  return (
    <div className={styles.toolRow}>
      <button
        type="button"
        className={styles.toolHead}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <svg aria-hidden="true" className={styles.toolIcon} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
          <path d={glyphOf(group.tool)} />
        </svg>
        <span>{label}</span>
        {detail ? <span className={styles.toolSummary}>{detail}</span> : null}
        <span aria-hidden="true" className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open
        ? group.calls.map((call, index) => (
            <details key={index} className={styles.toolDetail}>
              <summary>
                {toolLabel(call.name)}
                {call.argsSummary ? ` · ${call.argsSummary}` : ''}
                <span className={styles.toolStatus}>
                  {call.status === 'err' ? '失败' : call.latencyMs != null ? `${(call.latencyMs / 1000).toFixed(1)}s` : '完成'}
                </span>
              </summary>
              <pre className={styles.toolBody}>{call.name}</pre>
            </details>
          ))
        : null}
    </div>
  )
}

export function ToolRows({ tools }: { tools: AgentToolEventView[] }) {
  if (tools.length === 0) return null
  const groups = groupTools(tools)
  return (
    <div className={styles.toolRows}>
      {groups.map((group, index) => (
        <GroupRow key={`${group.tool}-${index}`} group={group} />
      ))}
    </div>
  )
}
