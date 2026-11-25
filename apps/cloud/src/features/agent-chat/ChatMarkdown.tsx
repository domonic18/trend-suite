'use client'

import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './agent-chat.module.css'

const plugins = [remarkGfm]

/**
 * 对话流 markdown 渲染（对齐 SasanImmersive RunMarkdown）：assistant 正文与
 * 确认卡问题都走这里——表格外包横滚、链接新窗、图片降级为 alt 文本。
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Markdown
        remarkPlugins={plugins}
        components={{
          table: ({ children }) => (
            <div className={styles.tableScroll}>
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  )
})
