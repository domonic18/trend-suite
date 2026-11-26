'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** 最近的纵向滚动容器（对话页滚动的是 .agent-body 自身）。 */
function scrollContainerOf(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
    node = node.parentElement
  }
  return null
}

/**
 * 滚动跟随三件套（对齐 SasanImmersive transcript）：
 * - ResizeObserver 观察内容增高（流式追加、卡片状态变化、工具行展开）；
 * - 80px 贴底阈值：用户上翻看历史时不抢滚动；
 * - 只动真实滚动容器；有待答确认卡且比视口高时定向滚到卡顶部而非底部。
 *
 * 依赖显式传入（lastSeq / busy / pending），不用「把依赖数组当参数」的写法——
 * 那样会绕过 exhaustive-deps 的保护。
 */
export function useChatScroll(deps: { lastSeq: number; busy: boolean; pending: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  /** 用户是否贴着底部——贴着才自动跟随。 */
  const stickyRef = useRef(true)
  const [showToBottom, setShowToBottom] = useState(false)
  const { lastSeq, busy, pending } = deps

  const scrollToBottom = useCallback(() => {
    const content = contentRef.current
    if (!content) return
    const container = containerRef.current ?? scrollContainerOf(content)
    if (!container) return
    const question = content.querySelector<HTMLElement>('[data-pending-question]')
    if (question && question.offsetHeight > container.clientHeight) {
      container.scrollTop += question.getBoundingClientRect().top - container.getBoundingClientRect().top
    } else {
      container.scrollTop = container.scrollHeight
    }
  }, [])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    containerRef.current = scrollContainerOf(content)
    const observer = new ResizeObserver(() => {
      if (stickyRef.current) scrollToBottom()
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollToBottom])

  useEffect(() => {
    const container = containerRef.current ?? scrollContainerOf(contentRef.current)
    if (!container) return
    const onScroll = (): void => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight
      stickyRef.current = distance < 80
      setShowToBottom(distance >= 240)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [])

  // 消息到达 / 状态变化时跟随
  useEffect(() => {
    if (stickyRef.current) scrollToBottom()
  }, [lastSeq, busy, pending, scrollToBottom])

  return { contentRef, showToBottom, scrollToBottom }
}
