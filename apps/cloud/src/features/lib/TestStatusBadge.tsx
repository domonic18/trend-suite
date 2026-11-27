import { memo } from 'react'

/**
 * 连通性测试三态徽章（模型条目 / 行情源共用）：
 * 测试中 → 「测试中…」；ok → 绿 ✓ + 延迟；failed → 红 ✗ 失败 + 截断原因
 * （≤48 字，全文悬浮）；未测过 → —。测试时间只进 title（不占版面）。
 */
export const TestStatusBadge = memo(function TestStatusBadge(props: {
  testing: boolean
  result: string | null
  latencyMs: number | null
  error: string | null
  testedAt?: string | null
}) {
  const tested = props.testedAt ? `测试于 ${props.testedAt.slice(0, 16).replace('T', ' ')}` : undefined
  if (props.testing) return <span className="text-xs text-mut">测试中…</span>
  if (props.result === 'ok') {
    return (
      <span className="text-[13px] text-success" title={[props.latencyMs != null ? `${props.latencyMs}ms` : null, tested].filter(Boolean).join(' · ') || undefined}>
        ✓ {props.latencyMs ?? '?'}ms
      </span>
    )
  }
  if (props.result === 'failed') {
    const reason = (props.error ?? '').replace(/\s+/g, ' ').trim()
    return (
      <>
        <span className="text-[13px] text-destructive" title={[reason || null, tested].filter(Boolean).join(' · ') || undefined}>
          ✗ 失败
        </span>
        {reason ? (
          <span className="text-xs text-mut" title={reason}>
            {reason.length > 48 ? `${reason.slice(0, 48)}…` : reason}
          </span>
        ) : null}
      </>
    )
  }
  return <span className="text-xs text-mut">未测试</span>
})
