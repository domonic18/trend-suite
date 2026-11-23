'use client'

import type {
  AgentPhase,
  AgentStreamResponse,
  AnswerQuestionResponse,
  SendMessageResponse,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

/** 发送一条用户消息（落库回显；agent 回复经 stream 增量到达）。 */
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

/** 回答确认卡（选项下标）；确定性动作由服务端按所选选项执行。 */
export function answerAgentQuestion(
  courseId: string,
  messageId: string,
  optionIndex: number,
): Promise<AnswerQuestionResponse> {
  return apiRequest<AnswerQuestionResponse>(
    `/v1/admin/content/courses/${courseId}/agent/messages/${messageId}/answer`,
    { method: 'POST', body: JSON.stringify({ optionIndex }) },
  )
}

/** 增量拉取线程消息（cursor=0 首拉全量）。 */
export function streamAgent(
  courseId: string,
  phase: AgentPhase,
  cursor: number,
): Promise<AgentStreamResponse> {
  return apiRequest<AgentStreamResponse>(
    `/v1/admin/content/courses/${courseId}/agent/${phase}/stream?cursor=${cursor}`,
  )
}
