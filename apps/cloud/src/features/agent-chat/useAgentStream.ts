'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMessageView, AgentPhase, AgentStreamResponse } from '@trend-suite/contracts'
import {
  answerAgentQuestion,
  openAgentEvents,
  sendAgentMessage,
  stopAgentRun,
  streamAgent,
} from './api'

const POLL_MS = 2_500
/** SSE 连续失败到此次数后永久降级轮询（arch/08 §3）。 */
const SSE_MAX_FAILURES = 3
const SSE_RETRY_MS = 1_500

export type AgentStream = ReturnType<typeof useAgentStream>

/**
 * 对话流数据层（arch/08 §3）：SSE 事件流主通道（fetch 流式读取 + 手写 SSE
 * 解析，帧按游标增量合并），断流自动重连；连续失败 3 次永久降级 2.5s 轮询。
 * send/answer/stop 成功后立刻补拉一次，让状态与新消息即时出现。
 */
export function useAgentStream(courseId: string, phase: AgentPhase) {
  const [messages, setMessages] = useState<AgentMessageView[]>([])
  const [agentBusy, setAgentBusy] = useState(false)
  const [pendingQuestionId, setPendingQuestionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const cursorRef = useRef(0)
  const pullingRef = useRef(false)

  const applySnapshot = useCallback((data: AgentStreamResponse) => {
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
  }, [])

  const pull = useCallback(async () => {
    if (pullingRef.current) return
    pullingRef.current = true
    try {
      applySnapshot(await streamAgent(courseId, phase, cursorRef.current))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      pullingRef.current = false
    }
  }, [courseId, phase, applySnapshot])

  // SSE 主通道：帧 = agentStreamResponse；正常收口（服务端 10 分钟）立即重连，
  // 失败退避重试，连续 3 次失败降级轮询。
  useEffect(() => {
    if (degraded) return
    const controller = new AbortController()
    let stopped = false
    let failures = 0
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    async function run() {
      while (!stopped && failures < SSE_MAX_FAILURES) {
        try {
          const body = await openAgentEvents(courseId, phase, cursorRef.current, controller.signal)
          failures = 0
          const reader = body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break // 服务端主动收口 → 立即重连
            buffer += decoder.decode(value, { stream: true })
            let sep = buffer.indexOf('\n\n')
            while (sep >= 0) {
              const frame = buffer.slice(0, sep)
              buffer = buffer.slice(sep + 2)
              sep = buffer.indexOf('\n\n')
              const data = frame
                .split('\n')
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .join('\n')
              if (!data) continue // 心跳注释行（: hb）
              try {
                applySnapshot(JSON.parse(data) as AgentStreamResponse)
                setError(null)
              } catch {
                // 坏帧丢弃，等下一帧
              }
            }
          }
        } catch {
          if (stopped || controller.signal.aborted) return
          failures += 1
          if (failures < SSE_MAX_FAILURES) await sleep(SSE_RETRY_MS * failures)
        }
      }
      if (!stopped) setDegraded(true)
    }

    void run()
    return () => {
      stopped = true
      controller.abort()
    }
  }, [courseId, phase, degraded, applySnapshot])

  // 降级通道：轮询。首挂载也先拉一次全量打底（SSE 连接前的首屏）。
  useEffect(() => {
    void pull()
    if (!degraded) return
    const timer = setInterval(() => void pull(), POLL_MS)
    return () => clearInterval(timer)
  }, [pull, degraded])

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
    async (messageId: string, optionIndex: number, note?: string): Promise<void> => {
      const data = await answerAgentQuestion(courseId, messageId, optionIndex, note)
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

  const stop = useCallback(async (): Promise<void> => {
    await stopAgentRun(courseId, phase)
    await pull()
  }, [courseId, phase, pull])

  /** 最新消息 seq——右栏工作区以它作 refreshKey 联动重取（arch/08 §6）。 */
  const lastSeq = useMemo(
    () => messages.reduce((max, m) => Math.max(max, m.seq), 0),
    [messages],
  )

  return { messages, agentBusy, pendingQuestionId, error, degraded, lastSeq, send, answer, stop }
}
