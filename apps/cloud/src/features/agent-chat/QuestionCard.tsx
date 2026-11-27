'use client'

import { useEffect, useRef, useState } from 'react'
import type { AgentQuestionOption } from '@trend-suite/contracts'
import styles from './agent-chat.module.css'

import dynamic from 'next/dynamic'

/** 对话 markdown 懒加载：streamdown + shiki 语法高亮是 bundle 大头，首屏不打包。 */
const ChatMarkdown = dynamic(() => import('./ChatMarkdown').then((m) => m.ChatMarkdown), { ssr: false })

/**
 * AskQuestion 确认卡（arch/08 §6，对齐 SasanImmersive ApprovalCard 的内嵌形态）：
 * radio 选项卡（label + 说明）+「填写其他想法」自由文本 + 提交；
 * 已答后折叠为「历史提问」可展开回看；被后续提问取代的未答卡显示取代说明。
 */
export function QuestionCard({
  question,
  options,
  locked,
  selectedIndex,
  selectedNote,
  answering,
  superseded,
  onAnswer,
}: {
  question: string
  options: AgentQuestionOption[]
  locked: boolean
  selectedIndex: number | null
  /** 已答卡展示的教师附言。 */
  selectedNote?: string | null
  answering: boolean
  /** 未答但已被后续提问/对话取代（409 不可补答）。 */
  superseded: boolean
  onAnswer: (optionIndex: number, note: string) => void
}) {
  const [picked, setPicked] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // 卡片重新激活（如新一轮提问）时重置本地草稿
  useEffect(() => {
    if (!locked) {
      setPicked(null)
      setNote('')
    }
  }, [locked])

  // 已答：折叠为历史提问，可展开回看
  if (locked) {
    return (
      <details className={`${styles.ask} ${styles.askDone}`} open>
        <summary className={styles.askSummary}>
          <span className={styles.askBadge}>历史提问</span>
          <span className={styles.askQ}>{question}</span>
          {selectedIndex !== null && options[selectedIndex] ? (
            <span className={styles.askChosen}>
              已选：<b>{options[selectedIndex].label}</b>
            </span>
          ) : null}
        </summary>
        <div className={styles.askBody}>
          <div className={styles.opts}>
            {options.map((option, index) => (
              <div
                key={index}
                className={`${styles.opt} ${selectedIndex === index ? styles.optOn : ''}`}
              >
                <span className={styles.optText}>
                  <b>{option.label}</b>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
                <span className={styles.optCheck} aria-hidden="true">✓</span>
              </div>
            ))}
          </div>
          {selectedNote ? <p className={styles.askNote}>附言：{selectedNote}</p> : null}
        </div>
      </details>
    )
  }

  // 被后续提问取代：不可作答，仅可展开查看
  if (superseded) {
    return (
      <details className={`${styles.ask} ${styles.askStale}`}>
        <summary className={styles.askSummary}>
          <span className={styles.askBadgeStale}>已被后续对话取代</span>
          <span className={styles.askQ}>{question}</span>
        </summary>
        <div className={styles.askBody}>
          <ChatMarkdown text={question} />
          <div className={styles.opts}>
            {options.map((option, index) => (
              <div key={index} className={styles.opt}>
                <span className={styles.optText}>
                  <b>{option.label}</b>
                  {option.description ? <small>{option.description}</small> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      </details>
    )
  }

  // 待答：radio 选项 + 附言 + 提交
  return (
    <fieldset
      className={styles.ask}
      data-pending-question
      disabled={answering}
    >
      <legend className={styles.askBadgeLive}>需要你确认</legend>
      <div className={styles.askBody}>
        <ChatMarkdown text={question} />
        <div className={styles.opts} role="radiogroup" aria-label="选项">
          {options.map((option, index) => (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={picked === index}
              className={`${styles.opt} ${styles.optBtn} ${picked === index ? styles.optOn : ''}`}
              onClick={() => setPicked(index)}
            >
              <span className={styles.optText}>
                <b>{option.label}</b>
                {option.description ? <small>{option.description}</small> : null}
              </span>
              <span className={styles.optCheck} aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
        <textarea
          ref={noteRef}
          className={styles.noteInput}
          value={note}
          maxLength={1000}
          rows={2}
          placeholder="填写其他想法（可选，随所选选项一起交给 Agent）"
          onChange={(event) => setNote(event.target.value)}
        />
        <div className={styles.askActions}>
          <button
            type="button"
            className={styles.askSubmit}
            disabled={picked === null || answering}
            onClick={() => picked !== null && onAnswer(picked, note.trim())}
          >
            {answering ? '提交中…' : '提交回答'}
          </button>
          <span className={styles.askHint}>或跳过这张卡，直接在下方输入框回复</span>
        </div>
      </div>
    </fieldset>
  )
}
