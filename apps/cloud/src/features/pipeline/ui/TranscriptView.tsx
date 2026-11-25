'use client'

import type { TranscriptResponse } from '@trend-suite/contracts'
import { formatTimestamp } from './processing'

/**
 * ASR 逐字稿（原型 teacher-material 的 .asr）：
 * 转写进行中先到的段落标 partial——可读，但不能作为大纲锁定依据。
 */
export function TranscriptView(props: {
  transcript: TranscriptResponse
}) {
  const { segments, complete } = props.transcript
  if (segments.length === 0) {
    return <div className="empty">还没有转写内容。</div>
  }
  const partialCount = segments.filter((s) => s.partial).length

  return (
    <>
      <div className="asr">
        <div className="ah">
          <span>ASR 逐字稿</span>
          <span className="grow" />
          <span>{complete ? `${segments.length} 段 · 已定稿` : `${segments.length} 段 · ${partialCount} 段待定稿`}</span>
        </div>
        {segments.map((segment) => (
          <div className="seg" key={segment.id}>
            <span className="ts">{formatTimestamp(segment.startMs)}</span>
            <span className="sp">{segment.speaker ?? '讲师'}</span>
            <span>
              {segment.text}
              {segment.partial ? <span className="chip">转写中</span> : null}
            </span>
          </div>
        ))}
      </div>
      {!complete ? (
        <div className="partial">
          已转部分可以先看，但暂时不能作为大纲锁定依据——转写完成后本标记消失。
        </div>
      ) : null}
    </>
  )
}
