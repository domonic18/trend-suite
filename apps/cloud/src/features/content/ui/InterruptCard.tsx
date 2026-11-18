'use client'

import { useState } from 'react'

/** 打断卡（T8 三动作：批准 / 微调 / 打回重起草）。未决项存在时批准禁用，且明示裁决去处。 */
export function InterruptCard({
  lowMatchCount,
  violationCount,
  canApprove,
  busy,
  onGoOutline,
  onApprove,
  onReject,
}: {
  lowMatchCount: number
  violationCount: number
  canApprove: boolean
  busy: boolean
  onGoOutline?: () => void
  onApprove: () => void
  onReject: (feedback: string) => void
}) {
  const [feedback, setFeedback] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const blocked = lowMatchCount > 0 || violationCount > 0

  return (
    <div className="interrupt" id="plan-interrupt">
      <div className="ih">
        <span className="tag run">等待你决定</span> 课程方案
      </div>
      <div className="it">
        {blocked
          ? `存在 ${lowMatchCount} 个证据不足的分节、${violationCount} 条拒绝记录，批准前需先裁决`
          : '方案四件套齐全，可批准锁定为基准版'}
      </div>
      {blocked ? (
        <div className="iblk">
          <span>
            证据不足的分节在上方大纲处理：改名 / 删除 / 与相近章合并；拒绝记录见本卡下方列表。
          </span>
          {onGoOutline ? (
            <button type="button" className="btn link" onClick={onGoOutline}>
              到大纲处理
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="ia">
        <button
          type="button"
          className="btn primary"
          disabled={busy || !canApprove}
          title={canApprove ? '' : '存在未决项，暂不可批准'}
          onClick={onApprove}
        >
          批准并锁定
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => setRejecting((v) => !v)}>
          打回重起草
        </button>
      </div>
      {rejecting ? (
        <div className="ia">
          <textarea
            rows={2}
            value={feedback}
            maxLength={2000}
            placeholder="打回意见：这一版哪里要改？"
            onChange={(e) => setFeedback(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || feedback.trim().length === 0}
            onClick={() => onReject(feedback.trim())}
          >
            提交意见
          </button>
        </div>
      ) : null}
    </div>
  )
}
