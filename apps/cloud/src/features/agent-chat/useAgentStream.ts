'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentMessageView, AgentPhase } from '@trend-suite/contracts'
import { answerAgentQuestion, sendAgentMessage, streamAgent } from './api'

const POLL_MS = 2_500

export type AgentStream = ReturnType<typeof useAgentStream>

/**
 * 对话流增量轮询（arch/08 §3）：2.5s 拉 seq > cursor 的增量，本地按 id 去重合并。
 * send/answer 成功后立刻补拉一次，让 typing 态与新消息即时出现，不等下一轮 tick。
 */
export function useAgentStream(courseId: string, phase: AgentPhase) {
  const [messages, setMessages] = useState<AgentMessageView[]>([])
  const [agentBusy, setAgentBusy] = useState(false)
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cursorRef = useRef(0)
  const pullingRef = useRef(false)

  const pull = useCallback(async () => {
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      const data = await streamAgent(courseId, phase, cursorRef.current)
      cursorRef.current = data.cursor
      setAgentBusy(data.agentBusy)
      setPendingQuestionId(data.pendingQuestionId)
      if (data.messages.length > 0) {
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const merged = [...prev, ...data.messages.filter((m) => !seen.has(m.id))]
          merged.sort((a, b) => a.seq - b.seq)
          return merged
        })
      }
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      pullingRef.current = false
    }
  }, [courseId, phase])

  useEffect(() => {
    void pull()
    const timer = setInterval(() => void pull(), POLL_MS)
    return () => clearInterval(timer)
  }, [pull])

  const send = useCallback(
    async (text: string): Promise<void> => {
      const data = await sendAgentMessage(courseId, phase, text)
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      )
      await pull()
    },
    [courseId, phase, pull],
  )

  const answer = useCallback(
    async (messageId: string, optionIndex: number): Promise<void> => {
      const data = await answerAgentQuestion(courseId, messageId, optionIndex)
      // 本地先回写 answeredIndex（其它端靠 answer 消息到达后锁定）。
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === 'question'
            ? { ...m, question: { ...m.question, answeredIndex: optionIndex } }
            : m,
        ),
      )
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message],
      )
      setPendingQuestionId(null)
      await pull()
    },
    [courseId, pull],
  )

  return { messages, agentBusy, pendingQuestionId, error, send, answer }
}
