'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentMessageView } from '@trend-suite/contracts'
import { QuestionCard } from './QuestionCard'
import { TodoCard } from './TodoCard'
import type { AgentStream } from './useAgentStream'

/**
 * 中置对话流（arch/08 §2，原型 teacher-plan.html 的 chat-center）：
 * 面包屑 + 头部（状态灯）+ 消息流（user/assistant/question/answer/todo/event）
 * + 底部快捷指令与 composer。流状态由调用方持有（useAgentStream）——
 * 同页的产物工作区可共享同一份轮询。课程级任务（如起草 job）在途时以
 * draftingLabel 呈现「正在起草」态；agent run 在途以 typing 态呈现。
 */
export function AgentChat({
  id,
  stream,
  crumb,
  subtitle,
  userName,
  draftingLabel = null,
  liveLabel = '正在起草',
  emptyHint,
  quickChips = [],
}: {
  id?: string
  stream: AgentStream
  crumb: string
  subtitle: string
  userName: string
  /** 课程级队列任务在途时的文案（如「正在起草方案…」）；null = 无。 */
  draftingLabel?: string | null
  /** draftingLabel 在途时状态灯的短文案（方案页「正在起草」/ 制作台「制作中」）。 */
  liveLabel?: string
  emptyHint: string
  quickChips?: string[]
}) {
  const { messages, agentBusy, pendingQuestionId, error, send, answer } = stream
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const busy = agentBusy || draftingLabel != null
  const live = draftingLabel
    ? { text: liveLabel, dot: 'dot-run' }
    : agentBusy
      ? { text: '正在处理', dot: 'dot-run' }
      : pendingQuestionId
        ? { text: '等你确认', dot: 'dot-wait' }
        : { text: '在线', dot: 'dot-ok' }

  // 确认卡锁定依据：卡自身 answeredIndex，或线程里已有指向它的 answer 行。
  const answeredBy = useMemo(() => {
    const map = new Map<string, number>()
    for (const message of messages) {
      if (message.role === 'answer') map.set(message.questionMessageId, message.optionIndex)
    }
    return map
  }, [messages])
  const lastTodoSeq = useMemo(
    () =>
      messages.reduce((max, m) => (m.role === 'todo' ? Math.max(max, m.seq) : max), -1),
    [messages],
  )

  useEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [messages.length, agentBusy, draftingLabel])

  async function submit(value: string) {
    if (!value || sending) return
    setSending(true)
    setActionError(null)
    try {
      await send(value)
      setText('')
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function choose(messageId: string, optionIndex: number) {
    setAnsweringId(messageId)
    setActionError(null)
    try {
      await answer(messageId, optionIndex)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setAnsweringId(null)
    }
  }

  return (
    <aside className="agent-rail" id={id} aria-label="制作 Agent 对话">
      <div className="agent-crumb">{crumb}</div>
      <div className="agent-head">
        <span className="agent-ava">制</span>
        <div className="agent-id">
          <b>制作 Agent</b>
          <small>{subtitle}</small>
        </div>
        <span className="agent-live">
          <i className={live.dot} />
          {live.text}
        </span>
      </div>

      <div className="agent-body" ref={bodyRef}>
        {error ? <div className="notice err">对话流加载失败：{error}</div> : null}
        {messages.length === 0 && !busy ? <p className="agent-empty">{emptyHint}</p> : null}
        {messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            userName={userName}
            isLatestTodo={message.role === 'todo' && message.seq === lastTodoSeq}
            answeredIndex={message.role === 'question'
              ? (message.question.answeredIndex ?? answeredBy.get(message.id) ?? null)
              : null}
            answering={answeringId === message.id}
            onAnswer={choose}
          />
        ))}
        {busy ? (
          <div className="msg">
            <span className="m-av">A</span>
            <div className="m-body">
              <div className="m-text">
                <p className="streaming">{draftingLabel ?? '正在思考…'}</p>
              </div>
            </div>
          </div>
        ) : null}
        {actionError ? <div className="notice err">{actionError}</div> : null}
      </div>

      <div className="agent-foot">
        {quickChips.length > 0 ? (
          <div className="quick">
            {quickChips.map((chip) => (
              <button key={chip} type="button" onClick={() => setText(chip)}>
                {chip}
              </button>
            ))}
          </div>
        ) : null}
        <div className="composer">
          <textarea
            value={text}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void submit(text.trim())
              }
            }}
            placeholder="与 Agent 对话：改方案、问进度、提需求…"
          />
          <div className="cr">
            <span className="grow" />
            <span className="kbd">⌘↵</span>
            <button
              type="button"
              className="send"
              title="发送"
              onClick={() => void submit(text.trim())}
              disabled={!text.trim() || sending}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function clockOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function MessageRow({
  message,
  userName,
  isLatestTodo,
  answeredIndex,
  answering,
  onAnswer,
}: {
  message: AgentMessageView
  userName: string
  isLatestTodo: boolean
  answeredIndex: number | null
  answering: boolean
  onAnswer: (messageId: string, optionIndex: number) => void
}) {
  switch (message.role) {
    case 'user':
      return (
        <div className="msg user">
          <span className="m-av">师</span>
          <div className="m-body">
            <div className="m-meta">{userName} · {clockOf(message.createdAt)}</div>
            <div className="m-text">
              <p>{message.text}</p>
            </div>
          </div>
        </div>
      )
    case 'assistant':
      return (
        <div className="msg">
          <span className="m-av">A</span>
          <div className="m-body">
            <div className="m-meta">制作 Agent · {clockOf(message.createdAt)}</div>
            {message.text ? (
              <div className="m-text">
                {message.text.split('\n').map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            ) : null}
            {message.tools.length > 0 ? (
              <div className="tool-group">
                <div className="tg-h">本轮工具 {message.tools.length} 次</div>
                {message.tools.map((tool, index) => (
                  <details key={index} className="tool">
                    <summary>
                      <span className="tn">{tool.name}</span>
                      <span className="ta">{tool.argsSummary}</span>
                      <span className="ts">
                        {tool.status === 'err'
                          ? '失败'
                          : tool.latencyMs != null
                            ? `${(tool.latencyMs / 1000).toFixed(1)}s`
                            : '完成'}
                      </span>
                    </summary>
                    <div className="tbody">{tool.argsSummary}</div>
                  </details>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )
    case 'question':
      return (
        <div className="msg">
          <span className="m-av">A</span>
          <div className="m-body">
            <QuestionCard
              question={message.question.text}
              options={message.question.options}
              locked={answeredIndex !== null}
              selectedIndex={answeredIndex}
              answering={answering}
              onAnswer={(index) => onAnswer(message.id, index)}
            />
          </div>
        </div>
      )
    case 'answer':
      return (
        <div className="ans">
          已选：<b>{message.label}</b>
        </div>
      )
    case 'todo':
      return isLatestTodo ? (
        <div className="msg">
          <span className="m-av">A</span>
          <div className="m-body">
            <TodoCard items={message.items} title={message.title ?? null} />
          </div>
        </div>
      ) : null
    case 'event':
      return (
        <div className={`ev ${message.level}`}>
          {message.detail ?? message.kind}
        </div>
      )
  }
}
