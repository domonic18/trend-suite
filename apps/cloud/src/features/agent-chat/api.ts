'use client'

import type {
  AgentPhase,
  AgentStreamResponse,
  AnswerQuestionResponse,
  SendMessageResponse,
  StopAgentRunResponse,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'
import { getToken } from '@/features/accounts/session'

/** 发送一条用户消息（落库回显；agent 回复经事件流增量到达）。 */
export function sendAgentMessage(
  courseId: string,
  phase: AgentPhase,
  text: string,
): Promise<SendMessageResponse> {
  return apiRequest<SendMessageResponse>(
    `/v1/admin/content/courses/${courseId}/agent/${phase}/messages`,
    { method: 'POST', body: JSON.stringify({ text }) },
  )
}

/** 回答确认卡（选项下标 + 可选附言）；确定性动作由服务端按所选选项执行。 */
export function answerAgentQuestion(
  courseId: string,
  messageId: string,
  optionIndex: number,
  note?: string,
): Promise<AnswerQuestionResponse> {
  return apiRequest<AnswerQuestionResponse>(
    `/v1/admin/content/courses/${courseId}/agent/messages/${messageId}/answer`,
    { method: 'POST', body: JSON.stringify(note ? { optionIndex, note } : { optionIndex }) },
  )
}

/** 停止本阶段的在途对话回复（轮边界安全中止）。 */
export function stopAgentRun(
  courseId: string,
  phase: AgentPhase,
): Promise<StopAgentRunResponse> {
  return apiRequest<StopAgentRunResponse>(
    `/v1/admin/content/courses/${courseId}/agent/${phase}/stop`,
    { method: 'POST' },
  )
}

/** 增量拉取线程消息（cursor=0 首拉全量）——SSE 失联时的降级通道。 */
export function streamAgent(
  courseId: string,
  phase: AgentPhase,
  cursor: number,
): Promise<AgentStreamResponse> {
  return apiRequest<AgentStreamResponse>(
    `/v1/admin/content/courses/${courseId}/agent/${phase}/stream?cursor=${cursor}`,
  )
}

/**
 * 打开 SSE 事件流（arch/08 §3 主通道）：会话令牌只走 Authorization 头，
 * 原生 EventSource 带不了头——用 fetch 流式读取，返回供手写 SSE 解析的 body。
 */
export async function openAgentEvents(
  courseId: string,
  phase: AgentPhase,
  cursor: number,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  const token = getToken()
  const res = await fetch(
    `/v1/admin/content/courses/${courseId}/agent/${phase}/events?cursor=${cursor}`,
    {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      signal,
      cache: 'no-store',
    },
  )
  if (!res.ok || !res.body) {
    throw new Error(`事件流连接失败（${res.status}）`)
  }
  return res.body
}