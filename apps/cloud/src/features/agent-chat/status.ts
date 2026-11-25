import type { AgentMessageView } from '@trend-suite/contracts'

/** 对话流状态徽章（arch/08 §6）：五态字典，从消息与流状态推导。 */
export type ChatStatus = 'running' | 'waiting' | 'idle' | 'stopped' | 'failed'

export const STATUS_TEXT: Record<ChatStatus, string> = {
  running: '正在处理',
  waiting: '待确认',
  idle: '在线',
  stopped: '已停止',
  failed: '已中断',
}

export function chatStatusOf(input: {
  agentBusy: boolean
  drafting: boolean
  pendingQuestionId: string | null
  messages: AgentMessageView[]
}): ChatStatus {
  // 终态事件只在它是「最后一条消息」时呈现——停止/失败后教师重新发起并得到
  // 回复，状态应回到在线，而不是被旧事件一直压住。
  const last = input.messages[input.messages.length - 1]
  if (last && last.role === 'event') {
    if (last.kind === 'run_failed') return 'failed'
    if (last.kind === 'chat_stopped') return 'stopped'
  }
  if (input.agentBusy || input.drafting) return 'running'
  if (input.pendingQuestionId) return 'waiting'
  return 'idle'
}

/** 空闲心跳文案：agent 在途但暂无新消息时，让页面不是死的。 */
export function heartbeatText(draftingLabel: string | null): string {
  return draftingLabel ?? 'Agent 正在工作…'
}
