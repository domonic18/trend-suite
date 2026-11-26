'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { useMemo, useRef, useState } from 'react'
import type { AgentMessageView } from '@trend-suite/contracts'
import { ChatMarkdown } from './ChatMarkdown'
import { QuestionCard } from './QuestionCard'
import { TodoPanel } from './TodoPanel'
import { ToolRows } from './ToolRows'
import { foldChatItems, latestTodo } from './foldMessages'
import { STATUS_TEXT, chatStatusOf, heartbeatText } from './status'
import { useChatScroll } from './useChatScroll'
import styles from './agent-chat.module.css'
import type { AgentStream } from './useAgentStream'

/**
 * 中置对话流（arch/08 §6，对齐 SasanImmersive RunWorkspace/transcript）：
 * 面包屑 + 状态徽章 + 页首 TODO 面板 + 消息流（markdown、事件折叠、确认卡）
 * + 快捷指令 + composer（Enter 发送、IME 保护、发送/停止合一）。
 * 滚动跟随三件套：贴底才跟随、上翻不抢、待答卡定向滚动。
 * 数据层由调用方持有（useAgentStream）——右栏以 lastSeq 联动重取。
 */
export function AgentChat({
  id,
  stream,
  crumb,
  subtitle,
  userName,
  draftingLabel = null,
  emptyHint,
  emptyAction = null,
  quickChips = [],
}: {
  id?: string
  stream: AgentStream
  crumb: string
  subtitle: string
  userName: string
  /** 课程级队列任务在途时的文案（如「正在起草方案…」）；null = 无。 */
  draftingLabel?: string | null
  emptyHint: string
  /** 空态主行动（如方案页首次打开的「选择素材，开始制作」）；null = 无。 */
  emptyAction?: { label: string; description?: string; onClick: () => void } | null
  quickChips?: string[]
}) {
  const { messages, agentBusy, pendingQuestionId, error, degraded, lastSeq, send, answer, stop } =
    stream
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const busy = agentBusy || draftingLabel != null
  const status = chatStatusOf({
    agentBusy,
    drafting: draftingLabel != null,
    pendingQuestionId,
    messages,
  })
  // 长线程不整屏渲染：默认只渲染最近 120 条，更早的按需展开（arch/08 §6）。
  const [visibleCount, setVisibleCount] = useState(120)
  const visibleMessages = useMemo(
    () => (messages.length > visibleCount ? messages.slice(-visibleCount) : messages),
    [messages, visibleCount],
  )
  const hiddenCount = messages.length - visibleMessages.length
  const items = useMemo(() => foldChatItems(visibleMessages), [visibleMessages])
  // 线程里有没有「对话」（user/assistant/question）——自动触发的生产只写
  // 系统事件，此时仍显示引导语，告诉教师可以吩咐 Agent（停止/继续/重试）。
  const hasNoDialogue = useMemo(
    () => !messages.some((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'question'),
    [messages],
  )
  const todo = useMemo(() => latestTodo(messages), [messages])

  const { contentRef, showToBottom, scrollToBottom } = useChatScroll({
    lastSeq,
    busy,
    pending: pendingQuestionId !== null,
  })

  // 确认卡锁定与附言依据：answer 行回指
  const answeredBy = useMemo(() => {
    const index = new Map<string, { optionIndex: number; note: string | null }>()
    for (const message of messages) {
      if (message.role === 'answer') {
        index.set(message.questionMessageId, {
          optionIndex: message.optionIndex,
          note: message.note ?? null,
        })
      }
    }
    return index
  }, [messages])

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  async function submit(value: string) {
    if (!value || sending) return
    setSending(true)
    setActionError(null)
    try {
      await send(value)
      setText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  async function stopRun() {
    setStopping(true)
    setActionError(null)
    try {
      await stop()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setStopping(false)
    }
  }

  async function choose(messageId: string, optionIndex: number, note: string) {
    setAnsweringId(messageId)
    setActionError(null)
    try {
      await answer(messageId, optionIndex, note || undefined)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setAnsweringId(null)
    }
  }

  // 发送/停止二合一：agent 在途且输入为空 → 停止；否则发送
  const stopMode = busy && !text.trim()

  return (
    <aside className="agent-rail" id={id} aria-label="制作 Agent 对话">
      <div className="agent-crumb">{crumb}</div>
      <div className="agent-head">
        <span className="agent-ava">制</span>
        <div className="agent-id">
          <b>制作 Agent</b>
          <small>{subtitle}</small>
        </div>
        <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
          <i className="dot-run" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </div>

      <TodoPanel todo={todo} />

      <div className="agent-body">
        <div className={styles.content} ref={contentRef}>
          {error ? (
            <Alert variant="destructive" className={`mb-2 ${degraded ? '' : styles.streamLost}`}>
              <AlertDescription>
                对话流{degraded ? '已降级为轮询' : '连接中断'}：{error}
              </AlertDescription>
            </Alert>
          ) : null}
          {hasNoDialogue && !busy ? (
            <div className="agent-empty">
              {emptyAction ? (
                <button type="button" className="agent-empty-card" onClick={emptyAction.onClick}>
                  <span className="agent-empty-art" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                      <path d="M7 4.5v15M17 4.5v15" strokeWidth="1.3" strokeDasharray="2 2.4" />
                      <path d="M10.6 9.6l3.6 2.4-3.6 2.4z" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                  <span className="agent-empty-title">{emptyAction.label}</span>
                  {emptyAction.description ? (
                    <span className="agent-empty-sub">{emptyAction.description}</span>
                  ) : null}
                </button>
              ) : null}
              <p>{emptyHint}</p>
            </div>
          ) : null}

          {hiddenCount > 0 ? (
            <button
              type="button"
              className={styles.moreHistory}
              onClick={() => setVisibleCount((prev) => prev + 200)}
            >
              展开更早的 {hiddenCount} 条
            </button>
          ) : null}

          {items.map((item, index) =>
            item.kind === 'events' ? (
              <EventGroup key={`ev-${index}`} events={item.events} hasErr={item.hasErr} />
            ) : (
              <MessageRow
                key={item.message.id}
                message={item.message}
                userName={userName}
                answeredBy={answeredBy}
                pendingQuestionId={pendingQuestionId}
                answering={answeringId === item.message.id}
                onAnswer={choose}
              />
            ),
          )}

          {busy ? (
            <div className="msg">
              <span className="m-av">A</span>
              <div className="m-body">
                <div className="m-text">
                  <p className="streaming">{heartbeatText(draftingLabel)}</p>
                </div>
              </div>
            </div>
          ) : null}
          {actionError ? (
            <Alert variant="destructive" className="mb-2">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>

      {showToBottom ? (
        <button
          type="button"
          className={styles.toBottom}
          onClick={scrollToBottom}
          aria-label="回到底部"
        >
          ↓ 回到底部
        </button>
      ) : null}

      <div className="agent-foot">
        {quickChips.length > 0 ? (
          <div className="quick">
            {quickChips.map((chip) => (
              <button key={chip} type="button" onClick={() => void submit(chip)}>
                {chip}
              </button>
            ))}
          </div>
        ) : null}
        <div className={`composer ${styles.composerBox}`}>
          <textarea
            ref={textareaRef}
            value={text}
            maxLength={20000}
            rows={1}
            className={styles.composerInput}
            placeholder="与 Agent 对话：给目标与目录、改方案、问进度…（Enter 发送，Shift+Enter 换行）"
            onChange={(event) => {
              setText(event.target.value)
              autoGrow()
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                void submit(text.trim())
              }
            }}
          />
          <div className="cr">
            <span className="grow" />
            {stopMode ? (
              <button
                type="button"
                className={styles.stopBtn}
                title="停止本轮回复"
                aria-label="停止本轮回复"
                onClick={() => void stopRun()}
                disabled={stopping}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendBtn}
                title="发送（当前任务结束后处理）"
                aria-label="发送"
                onClick={() => void submit(text.trim())}
                disabled={!text.trim() || sending}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M12 19V6M6.5 11.5L12 6l5.5 5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}

function EventGroup({
  events,
  hasErr,
}: {
  events: AgentMessageView[]
  hasErr: boolean
}) {
  if (events.length === 1) {
    const event = events[0]!
    return (
      <div className={`ev ${event.role === 'event' ? event.level : 'info'}`}>
        {event.role === 'event' ? (event.detail ?? event.kind) : ''}
      </div>
    )
  }
  // 大组（重试循环可产生几十条）即使含失败也默认折叠——摘要行已标红，
  // 展开是用户的选择；小组含失败仍默认展开（失败不静默）。
  const openByDefault = hasErr && events.length <= 6
  return (
    <details className={`${styles.evGroup} ${hasErr ? styles.evGroupOpen : ''}`} open={openByDefault}>
      <summary className={styles.evSummary}>
        <span className={styles.evCount}>{events.length} 条系统事件</span>
        {hasErr ? <span className={styles.evErrTag}>含失败</span> : null}
      </summary>
      {events.map((event) =>
        event.role === 'event' ? (
          <div key={event.id} className={`ev ${event.level}`}>
            {event.detail ?? event.kind}
          </div>
        ) : null,
      )}
    </details>
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
  answeredBy,
  pendingQuestionId,
  answering,
  onAnswer,
}: {
  message: AgentMessageView
  userName: string
  answeredBy: Map<string, { optionIndex: number; note: string | null }>
  pendingQuestionId: string | null
  answering: boolean
  onAnswer: (messageId: string, optionIndex: number, note: string) => void
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
            {message.thinking ? (
              <details className={styles.think}>
                <summary className={styles.thinkSummary}>思考过程</summary>
                <div className={styles.thinkBody}>
                  <ChatMarkdown text={message.thinking} />
                </div>
              </details>
            ) : null}
            {message.text ? (
              <div className="m-text">
                <ChatMarkdown text={message.text} />
              </div>
            ) : null}
            <ToolRows tools={message.tools} />
          </div>
        </div>
      )
    case 'question': {
      const known = answeredBy.get(message.id)
      const answeredIndex = message.question.answeredIndex ?? known?.optionIndex ?? null
      return (
        <div className="msg">
          <span className="m-av">A</span>
          <div className="m-body">
            <QuestionCard
              question={message.question.text}
              options={message.question.options}
              locked={answeredIndex !== null}
              selectedIndex={answeredIndex}
              selectedNote={answeredIndex !== null ? (known?.note ?? null) : null}
              answering={answering}
              superseded={answeredIndex === null && pendingQuestionId !== message.id}
              onAnswer={(optionIndex, note) => onAnswer(message.id, optionIndex, note)}
            />
          </div>
        </div>
      )
    }
    case 'answer':
      return (
        <div className="ans">
          已选：<b>{message.label}</b>
          {message.note ? <span className={styles.ansNote}>（附言：{message.note}）</span> : null}
        </div>
      )
    case 'todo':
      return null // TodoPanel 渲染最新一份
    case 'event':
      return (
        <div className={`ev ${message.level}`}>{message.detail ?? message.kind}</div>
      )
  }
}
