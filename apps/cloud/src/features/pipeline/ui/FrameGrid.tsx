'use client'

import type { MediaFrameView } from '@trend-suite/contracts'
import { formatTimestamp } from './processing'

/** 关键帧网格（原型 teacher-material 的 .kfgrid）。 */
export function FrameGrid(props: { frames: MediaFrameView[] }) {
  if (props.frames.length === 0) {
    return <div className="empty">还没有关键帧。</div>
  }
  return (
    <div className="kfgrid">
      {props.frames.map((frame) => (
        <figure className="kf" key={frame.id}>
          {/* 帧地址是短时签名地址，浏览器直接取图，不必带会话头 */}
          <img src={frame.url} alt={`关键帧 ${formatTimestamp(frame.atMs)}`} loading="lazy" />
          <figcaption>
            <span className="ts">{formatTimestamp(frame.atMs)}</span>
            {frame.caption ? <span>{frame.caption}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
