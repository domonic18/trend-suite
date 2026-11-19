'use client'

import { useMemo, useState } from 'react'
import { generateBars, type FigureView, type WidgetView } from '@trend-suite/contracts'
import { MiniChart } from '../MiniChart'
import { annotatorVerdict } from '../widgetView'

/** 对比侧：图示 id 或生成器参数（与契约的 juxtaposeSide 同形状）。 */
type JuxtaposeSide =
  | { figureId: string }
  | { generator: 'uptrend' | 'downtrend' | 'range' | 'uptrend-platform' | 'downtrend-platform'; seed: number; bars: number }

/**
 * 依赖图表的互动课件：趋势线标注、分步解盘、两图对比滑块。
 * 图表数值一律由生成器按 (generator, seed, bars) 复算（契约包 widget-data.ts），
 * 组件不持有也不改写数值——同一份实现，服务端与客户端算得一模一样。
 */

/** kline-annotator：在 K 线上点两个锚点画趋势线，即时给出三项断言的本地判定。 */
export function KlineAnnotator({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [points, setPoints] = useState<{ idx: number; price: number }[]>([])
  const [showAnswer, setShowAnswer] = useState(false)
  const bars = useMemo(
    () => (spec.type === 'kline-annotator' ? generateBars(spec.data.generator, spec.data.seed, spec.data.bars) : []),
    [spec],
  )
  const verdict = useMemo(() => annotatorVerdict(spec, points), [spec, points])
  if (spec.type !== 'kline-annotator') return null

  const solutionLine =
    showAnswer && bars.length > 0
      ? [
          {
            fromIdx: spec.solution.trendline.startIdx,
            toIdx: spec.solution.trendline.endIdx,
            price0: bars[spec.solution.trendline.startIdx]?.c ?? 0,
            price1: bars[spec.solution.trendline.endIdx]?.c ?? 0,
            color: '#8b94a9',
            dashed: true,
          },
        ]
      : undefined
  const userLine =
    points.length === 2
      ? [
          {
            fromIdx: points[0]!.idx,
            toIdx: points[1]!.idx,
            price0: points[0]!.price,
            price1: points[1]!.price,
            color: verdict?.ok ? '#0f9d76' : '#d9483f',
          },
        ]
      : undefined

  const lines = [...(userLine ?? []), ...(solutionLine ?? [])]

  return (
    <div className="widget-card">
      <p className="widget-q">{spec.task}</p>
      <MiniChart
        bars={bars}
        height={220}
        withMa
        {...(lines.length > 0 ? { lines } : {})}
        onPick={(index) => {
          const bar = bars[index]
          if (!bar) return
          setPoints((current) => (current.length >= 2 ? [{ idx: index, price: bar.c }] : [...current, { idx: index, price: bar.c }]))
        }}
      />
      <div className="widget-actions">
        <span className="meta">
          {points.length === 0 ? '点第一个锚点' : points.length === 1 ? '点第二个锚点' : '画线完成'}
        </span>
        <button type="button" className="btn link" onClick={() => setPoints([])}>
          重画
        </button>
        <button type="button" className="btn link" onClick={() => setShowAnswer((v) => !v)}>
          {showAnswer ? '收起答案' : '看标准答案'}
        </button>
      </div>
      {verdict ? (
        <ul className="widget-checks">
          {verdict.checks.map((check) => (
            <li key={check.name} className={check.ok ? 'ok' : 'bad'}>
              {check.ok ? '✓' : '✕'} {check.name}：{check.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {spec.annotations?.length ? (
        <ul className="widget-notes">
          {spec.annotations.map((annotation) => (
            <li key={`${annotation.idx}-${annotation.label}`}>
              <span className="tag gray">{annotation.kind ?? 'structure'}</span> {annotation.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** step-reveal：分步解盘——一步步揭示并给出该步结论。 */
export function StepReveal({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [step, setStep] = useState(0)
  const bars = useMemo(
    () => (spec.type === 'step-reveal' ? generateBars(spec.data.generator, spec.data.seed, spec.data.bars) : []),
    [spec],
  )
  if (spec.type !== 'step-reveal') return null
  const current = spec.steps[step]
  const markers = current?.markers?.map((marker) => ({
    idx: marker.idx,
    label: marker.label ?? '',
    color: '#2563eb',
  }))
  const highlights = current ? [{ from: current.fromIdx, to: current.toIdx, color: 'rgba(37,99,235,0.10)' }] : []
  return (
    <div className="widget-card">
      <p className="widget-q">
        第 {step + 1} / {spec.steps.length} 步：{current?.title ?? '解盘完成'}
      </p>
      <MiniChart
        bars={bars}
        height={200}
        withMa
        {...(highlights ? { highlights } : {})}
        {...(markers ? { markers } : {})}
      />
      {current ? <p className="widget-conclusion">{current.conclusion}</p> : null}
      <div className="widget-actions">
        <button type="button" className="btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          上一步
        </button>
        <button
          type="button"
          className="btn"
          disabled={step >= spec.steps.length - 1}
          onClick={() => setStep((s) => Math.min(spec.steps.length - 1, s + 1))}
        >
          下一步
        </button>
        <span className="grow" />
        {step >= spec.steps.length - 1 ? <span className="widget-final">{spec.finalConclusion}</span> : null}
      </div>
    </div>
  )
}

/** image-juxtaposition：两图对比滑块（课程画面 vs 合成 K 线）。 */
export function ImageJuxtaposition({
  widget,
  figures,
}: {
  widget: WidgetView
  figures: ReadonlyMap<string, FigureView>
}) {
  const spec = widget.spec
  const [split, setSplit] = useState(50)
  const sideBars = useMemo(() => {
    if (spec.type !== 'image-juxtaposition') return { left: [], right: [] }
    const build = (side: JuxtaposeSide) =>
      'figureId' in side ? [] : generateBars(side.generator, side.seed, side.bars)
    return { left: build(spec.left), right: build(spec.right) }
  }, [spec])
  if (spec.type !== 'image-juxtaposition') return null

  const panel = (side: JuxtaposeSide, bars: ReturnType<typeof generateBars>) => {
    if ('figureId' in side) {
      const figure = figures.get(side.figureId)
      if (!figure) return <div className="widget-panel empty">图示 {side.figureId} 不在本节图示集内</div>
      if (figure.svg) {
        return <div className="widget-panel" dangerouslySetInnerHTML={{ __html: figure.svg }} />
      }
      if (figure.url) {
        return (
          <div className="widget-panel">
            <img src={figure.url} alt={figure.caption} loading="lazy" />
          </div>
        )
      }
      return <div className="widget-panel empty">图示 {figure.caption} 暂无可渲染内容</div>
    }
    return (
      <div className="widget-panel">
        <MiniChart bars={bars} height={170} withMa />
      </div>
    )
  }

  return (
    <div className="widget-card">
      <div className="widget-juxtaposition">
        <div className="widget-juxtaposition-stage">
          {panel(spec.right, sideBars.right)}
          <div className="widget-juxtaposition-top" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
            {panel(spec.left, sideBars.left)}
          </div>
          <div className="widget-juxtaposition-handle" style={{ left: `${split}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
        />
        <div className="widget-juxtaposition-labels">
          <span>{spec.labels.left}</span>
          <span>{spec.labels.right}</span>
        </div>
      </div>
      <div className="widget-captions">
        <p>{spec.captions.left}</p>
        <p>{spec.captions.right}</p>
      </div>
    </div>
  )
}
