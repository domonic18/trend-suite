'use client'

import { memo } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import styles from './agent-chat.module.css'

/**
 * 对话流 markdown 渲染：Vercel Streamdown（react-markdown 的流式强化版）——
 * 块级 memo（流式刷新时已完成块不重渲染）、断裂语法容错、内置 code/表格
 * 工具（复制等）。观感对齐对话流的紧凑排版：字号/间距由 module.css 的
 * .markdown 覆盖层微调（data-streamdown 根属性选择器）；动画与 caret 关闭
 * （我们的 SSE 是整帧到达，无逐 token 打字态）；图片降级为 alt 文本。
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className={styles.markdown}>
      <Streamdown
        mode="static"
        animated={false}
        controls={false}
        codeBlockMaxHeight={0}
        tableMaxHeight={0}
        shikiTheme={['github-light', 'github-dark']}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- streamdown 的 Components 索引签名要求 Record<string, unknown> 参数
          a: ({ href, children }: any) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
          img: ({ alt }: any) => <span>{alt}</span>,
        }}
      >
        {text}
      </Streamdown>
    </div>
  )
})
