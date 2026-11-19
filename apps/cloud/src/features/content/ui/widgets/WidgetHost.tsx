'use client'

import type { FigureView, WidgetView } from '@trend-suite/contracts'
import { BarReplayWidget } from './BarReplayWidget'
import { ImageJuxtaposition, KlineAnnotator, StepReveal } from './ChartWidgets'
import { BranchingScenario, Flashcards, TimelineExplorer } from './InfoWidgets'
import { CalcTrainer, Checklist, McqQuiz, PatternQuiz } from './QuizWidgets'

/**
 * 课件宿主（arch/06 §7/§9）：11 类白名单**全部有渲染**——不留「有 spec 无渲染」
 * 的洞（预览页与学员端同一份注册表）。
 * 头部的断言徽章显示服务端程序证明的结果（arch/06 §11：只记证明，不记学员作答）。
 */

const WIDGET_TITLES: Record<WidgetView['type'], string> = {
  'kline-annotator': 'K 线标注练习',
  'pattern-quiz': '形态识别',
  'mcq-quiz': '概念选择',
  'step-reveal': '分步解盘',
  'calc-trainer': '计算训练',
  flashcards: '术语卡',
  checklist: '检查清单',
  'timeline-explorer': '知识依赖',
  'image-juxtaposition': '两图对比',
  'branching-scenario': '决策情景',
  'bar-replay-decision': '逐根回放',
}

export function WidgetHost({
  widget,
  figures,
}: {
  widget: WidgetView
  figures?: ReadonlyMap<string, FigureView>
}) {
  const figureMap = figures ?? new Map<string, FigureView>()
  return (
    <section className="widget-box">
      <header className="widget-head">
        <b>{WIDGET_TITLES[widget.type]}</b>
        <span className="meta">{widget.code ? `案例股 ${widget.code}` : `v${widget.version}`}</span>
        <span className="grow" />
        <span className="widget-assertions">
          {widget.assertions.map((assertion) => (
            <span
              key={assertion.name}
              className={`tag ${assertion.status === 'pass' ? 'ready' : 'draft'}`}
              title={assertion.detail}
            >
              {assertion.name}
            </span>
          ))}
        </span>
      </header>
      <WidgetBody widget={widget} figures={figureMap} />
    </section>
  )
}

function WidgetBody({ widget, figures }: { widget: WidgetView; figures: ReadonlyMap<string, FigureView> }) {
  switch (widget.type) {
    case 'mcq-quiz':
      return <McqQuiz widget={widget} />
    case 'pattern-quiz':
      return <PatternQuiz widget={widget} />
    case 'calc-trainer':
      return <CalcTrainer widget={widget} />
    case 'checklist':
      return <Checklist widget={widget} />
    case 'flashcards':
      return <Flashcards widget={widget} />
    case 'timeline-explorer':
      return <TimelineExplorer widget={widget} />
    case 'branching-scenario':
      return <BranchingScenario widget={widget} />
    case 'kline-annotator':
      return <KlineAnnotator widget={widget} />
    case 'step-reveal':
      return <StepReveal widget={widget} />
    case 'image-juxtaposition':
      return <ImageJuxtaposition widget={widget} figures={figures} />
    case 'bar-replay-decision':
      return <BarReplayWidget widget={widget} />
  }
}
