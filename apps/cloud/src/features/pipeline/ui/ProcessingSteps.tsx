'use client'

import type { MediaAssetView, ProcessingStep } from '@trend-suite/contracts'
import { STEP_LABELS, STEP_ORDER } from './processing'

/**
 * 加工步进条（原型 teacher-material 的 .pipe）：
 * 已完成的阶段标 done，当前阶段标 cur，未到的等待。
 */
export function ProcessingSteps(props: {
  asset: MediaAssetView
  /** 当前阶段的细分说明（如「已出 79 段」）。 */
  detail?: string | null
}) {
  const currentIndex = STEP_ORDER.indexOf(props.asset.processStep as ProcessingStep)
  const failed = props.asset.jobStatus === 'failed' || props.asset.status === 'failed'

  return (
    <div className="pipe">
      {STEP_ORDER.map((step, index) => {
        // 就绪是终态成功，不该显示成「进行中」的警示色。
        const settled = currentIndex === index && step === 'done' && !failed
        const done = currentIndex > index || settled
        const cur = currentIndex === index && !done
        const label = STEP_LABELS[step]
        const note =
          step === props.asset.processStep ? (props.detail ?? props.asset.processMessage) : null
        const sub =
          step === 'uploaded' && props.asset.byteSize !== null
            ? `${(props.asset.byteSize / 1024 ** 3).toFixed(2)} GiB`
            : (note ?? '')
        return (
          <div key={step} className={done ? 'p done' : cur ? 'p cur' : 'p'}>
            <b>{label}</b>
            <span>{sub}</span>
          </div>
        )
      })}
    </div>
  )
}
