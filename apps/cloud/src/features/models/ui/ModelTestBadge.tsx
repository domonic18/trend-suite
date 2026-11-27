import { memo } from 'react'

/**
 * 连通性测试三态徽章（对齐家族 aitech-hub TestStatusBadge 形态）：
 * 测试中 → 「测试中…」；ok → 绿 ✓ + 延迟毫秒；failed → 红 ✗ 失败 + 截断原因
 * （≤48 字，全文悬浮）；未测过 → —。
 */
export const ModelTestBadge = memo(function ModelTestBadge(props: {
  testing: boolean
  result: string | null
  latencyMs: number | null
  error: string | null
  testedAt: string | null
}) {
  const time = props.testedAt ? (
    <span className="text-xs text-mut"> {props.testedAt.slice(0, 16).replace('T', ' ')}</span>
  ) : null
  if (props.testing) return <span className="text-xs text-mut">测试中…</span>
  if (props.result === 'ok') {
    return (
      <>
        <span
          className="text-success"
          title={props.latencyMs != null ? `${props.latencyMs}ms` : undefined}
        >
          ✓ {props.latencyMs ?? '?'}ms
        </span>
        {time}
      </>
    )
  }
  if (props.result === 'failed') {
    const reason = (props.error ?? '').replace(/\s+/g, ' ').trim()
    return (
      <>
        <span className="text-destructive" title={reason || undefined}>
          ✗ 失败
        </span>
        {reason ? (
          <span className="text-xs text-mut" title={reason}>
            {' '}
            {reason.length > 48 ? `${reason.slice(0, 48)}…` : reason}
          </span>
        ) : null}
        {time}
      </>
    )
  }
  return <>—</>
})
