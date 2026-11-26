'use client'

import { Badge } from '@/components/ui/badge'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { Button } from '@/components/ui/button'

import { useMemo, useState } from 'react'
import type { WidgetView } from '@trend-suite/contracts'
import { MiniChart } from '../MiniChart'
import { pendingDecision, replayPlan, replayVerdict, revealAnnotationFor } from '../widgetView'

/**
 * 逐根回放（bar-replay-decision，arch/06 §10）：**先判断后揭晓**。
 *
 * 铁律落到运行时：行情是真实缓存的 bars（宿主取，spec 不存数值），
 * 纵轴按全区间定标（揭示时不跳轴），未揭示区盖住——学员看不到后市；
 * 作答只在本机即时反馈，不落库、不上报（arch/06 §11）。
 */

type AnswerRecord = {
  question: string
  correct: boolean
  correctLabel: string
  atDate: string
}

export function BarReplayWidget({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const bars = widget.bars ?? []
  const plan = useMemo(() => (spec.type === 'bar-replay-decision' ? replayPlan(spec, bars) : null), [spec, bars])
  const [revealed, setRevealed] = useState(0)
  const [answered, setAnswered] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [records, setRecords] = useState<AnswerRecord[]>([])

  if (spec.type !== 'bar-replay-decision' || !plan) {
    return (
      <div className="widget-card">
        <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>回放课件 {widget.code ?? ''} 暂无可用行情——行情源不可用时不编造 K 线。</AlertDescription>
    </Alert>
      </div>
    )
  }

  const pending = pendingDecision(plan, revealed, answered)
  const revealedMarks = plan.marks.filter((mark) => mark.barIdx >= 0 && mark.barIdx < revealed)
  const finished = revealed >= plan.bars.length && !pending
  const correctCount = records.filter((record) => record.correct).length

  const revealMore = () => {
    if (pending) return
    setRevealed((current) => Math.min(plan.bars.length, current + 1))
  }

  return (
    <div className="widget-card">
      <div className="widget-progress">
        案例股 {spec.code} · 窗口 {spec.window.from} ~ {spec.window.to} · 已揭示 {revealed} / {plan.bars.length} 根
      </div>
      <MiniChart
        bars={plan.bars}
        height={230}
        visibleUpTo={Math.max(1, revealed)}
        maskFrom={Math.max(1, revealed)}
        markers={revealedMarks.map((mark) => ({
          idx: mark.barIdx,
          label: mark.annotation.label,
          color: mark.annotation.kind === 'invalidation' ? '#d9483f' : '#2563eb',
        }))}
      />
      <div className="widget-actions">
        <Button variant="outline" size="sm" onClick={revealMore} disabled={Boolean(pending) || finished}>
          揭示下一根
        </Button>
        <Button
          variant="link" size="sm"
          onClick={() => {
            setRevealed(0)
            setAnswered(0)
            setSelected(null)
            setRecords([])
          }}
        >
          重来
        </Button>
        <span className="grow" />
        <span className="meta">
          已答 {records.length} / {plan.points.length} 处 · 对 {correctCount} 处
        </span>
      </div>

      {pending ? (
        <div className="widget-question">
          <p className="widget-q">
            {pending.decision.atDate} · 第 {pending.index + 1} 处判断：{pending.decision.question}
          </p>
          <div className="widget-options column">
            {pending.decision.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`widget-option${selected === option.label ? ' on' : ''}`}
                onClick={() => setSelected(option.label)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {selected === null ? (
            <div className="widget-actions">
              <Button variant="outline" size="sm" disabled>
                提交作答
              </Button>
              <span className="meta">先选一个选项再提交——提交后不可回改。</span>
            </div>
          ) : (
            <div className="widget-actions">
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  const verdict = replayVerdict(pending.decision, selected)
                  setRecords((current) => [
                    ...current,
                    {
                      question: pending.decision.question,
                      correct: verdict.correct,
                      correctLabel: verdict.correctLabel,
                      atDate: pending.decision.atDate,
                    },
                  ])
                  setAnswered((count) => count + 1)
                  setSelected(null)
                }}
              >
                提交作答
              </Button>
              <span className="meta">提交后不可回改。</span>
            </div>
          )}
        </div>
      ) : null}

      {records.length > 0 ? (
        <div className="widget-reveals">
          {records.map((record, index) => {
            const point = plan.points[index]
            const mark = point ? revealAnnotationFor(plan, point.decision) : null
            return (
              <div key={`${record.atDate}-${index}`} className="widget-reveal">
                <b>
                  {record.atDate} · {record.correct ? '判断正确' : `判断有误（正确答案：${record.correctLabel}）`}
                </b>
                <p>{point?.decision.revealText}</p>
                {mark ? (
                  <p className="widget-annotation">
                    <Badge className="tag gray">{mark.annotation.kind}</Badge> {mark.annotation.label}
                    <span className="meta">
                      （素材单元 {mark.annotation.unitId} · {Math.round(mark.annotation.atMs / 1000)}s）
                    </span>
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {finished ? (
        <div className="widget-summary">
          <b>回放结束</b>
          <p>
            {records.length} 处判断，对了 {correctCount} 处。
            {records.length > correctCount
              ? '错因多在「只看形态、不看量能与位置」——回到本节检查清单再看一遍。'
              : '判断点都踩对了，继续保持。'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
