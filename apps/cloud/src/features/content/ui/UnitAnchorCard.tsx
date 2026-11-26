'use client'

import { Badge } from '@/components/ui/badge'

import { Button } from '@/components/ui/button'

import Link from 'next/link'
import type { SourceUnitView } from '@trend-suite/contracts'

/**
 * 素材证据锚点卡（验收②）：点正文 [[unit:]] 锚弹出——时间窗、转写原话、
 * 画面描述、讲解要点、跳素材页。「事实可回溯」的落地端点。
 */

function msToClock(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function UnitAnchorCard({
  unit,
  courseId,
  onClose,
}: {
  unit: SourceUnitView
  courseId: string
  onClose: () => void
}) {
  return (
    <div className="unit-card">
      <div className="unit-card-top">
        <Badge className="tag gray">原片 {msToClock(unit.startMs)} ~ {msToClock(unit.endMs)}</Badge>
        {unit.playable ? <Badge className="tag ready">可回放</Badge> : <Badge className="tag gray">HLS 未产出</Badge>}
        <span className="grow" />
        <Button variant="link" size="sm" asChild>
          <Link href={`/workbench/courses/${courseId}`}>打开素材页</Link>
        </Button>
        <Button variant="link" size="sm" onClick={onClose}>
          收起
        </Button>
      </div>
      <blockquote className="unit-card-quote">{unit.text}</blockquote>
      {unit.visualDesc ? (
        <p className="unit-card-visual">
          <b>画面</b>
          {unit.visualDesc}
        </p>
      ) : null}
      {unit.chartType ? (
        <p className="unit-card-visual">
          <b>图表类型</b>
          {unit.chartType}
        </p>
      ) : null}
      {unit.teachingPoints.length > 0 ? (
        <ul className="unit-card-points">
          {unit.teachingPoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
