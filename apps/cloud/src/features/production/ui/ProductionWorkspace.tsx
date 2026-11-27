'use client'

import { storageKeys } from '@/lib/storageKeys'

import { routes } from '@/lib/routes'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

import { WORKSPACE_TABS, EmptyPanel, type WorkspaceTabKey } from '@/features/courseware/ui/workspaceTabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type {
  ProductionBoardView,
  ProductionSectionRow,
  SectionContentView,
  SectionQuotesView,
  SourceUnitView,
} from '@trend-suite/contracts'
import { ClipCard } from '@/features/courseware/ui/ClipCard'
import { DslRenderer } from '@/features/courseware/ui/DslRenderer'
import { FigureCard } from '@/features/courseware/ui/FigureCard'
import { WidgetHost } from '@/features/courseware/ui/widgets/WidgetHost'
import type { FigureView } from '@trend-suite/contracts'
import { KlineChart } from '@/features/courseware/ui/KlineChart'

/**
 * 制作台右栏工作区（arch/08 §6）：页签 = 课件元素类别（大纲 / 课件 / 配图 /
 * 视频 / K线图 / 练习题 / 互动）；头部给标题、状态标与制作进度；页签状态本地
 * 持久化。只呈现产物与微调入口——工作交互都在左栏对话流。
 */



/** K 线类课件：K 线标注练习 + 逐根回放决策。 */
const KLINE_TYPES = new Set<string>(['kline-annotator', 'bar-replay-decision'])
/** 练习题类：可作答可判分的测验组件（术语卡也算自测练习）。 */
const QUIZ_TYPES = new Set<string>(['mcq-quiz', 'pattern-quiz', 'calc-trainer', 'flashcards'])

const FIGURE_KINDS: ReadonlyArray<{ kind: FigureView['kind']; label: string }> = [
  { kind: 'keyframe', label: '关键帧' },
  { kind: 'diagram', label: '示意图' },
  { kind: 'generated', label: '装饰图' },
]

export function stepClass(status: string): string {
  if (status === 'done') return 'd'
  if (status === 'running') return 'r'
  if (status === 'pending_manual' || status === 'failed') return 'w'
  return ''
}

export function sectionStateOf(section: ProductionBoardView['sections'][number]): string {
  if (section.status === 'complete') return '已完成'
  if (section.tasks.some((task) => task.status === 'running')) return '进行中'
  if (section.tasks.some((task) => task.status === 'pending_manual' || task.status === 'failed'))
    return '挂起待人工'
  if (section.products > 0) return '推进中'
  return '排队中'
}

export function ProductionWorkspace({
  board,
  courseId,
  current,
  currentId,
  content,
  quotes,
  assetNames,
  error,
  busy,
  syncing,
  onSelectSection,
  onRetry,
  onSyncQuotes,
}: {
  board: ProductionBoardView | null
  courseId: string
  /** 当前展示的节（父组件按「跟随正在跑的节 + 教师钉住」推导，父组件也用它取正文与行情）。 */
  current: ProductionSectionRow | null
  currentId: string | null
  content: SectionContentView | null
  quotes: SectionQuotesView | null
  assetNames: Map<string, string>
  error: string | null
  busy: boolean
  syncing: boolean
  onSelectSection: (sectionId: string) => void
  onRetry: (sectionId: string) => void
  onSyncQuotes: () => void
}) {
  const [tab, setTab] = useState<WorkspaceTabKey>('artifact')

  // 页签与宽度一样持久化：刷新后还在教师上次看的位置。
  useEffect(() => {
    const saved = window.localStorage.getItem(storageKeys.workspaceTab('production'))
    if (saved && WORKSPACE_TABS.some((item) => item.key === saved)) setTab(saved as WorkspaceTabKey)
  }, [])
  const selectTab = (next: WorkspaceTabKey) => {
    setTab(next)
    window.localStorage.setItem(storageKeys.workspaceTab('production'), next)
  }

  const sections = board?.sections ?? []
  const boardReady = board != null && sections.length > 0
  const runningTask = current?.tasks.find((task) => task.status === 'running') ?? null

  const doneSteps = sections.reduce((sum, section) => sum + section.products, 0)
  const totalSteps = sections.length * 9
  const progressPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0
  const suspendedCount = sections.filter((section) =>
    section.tasks.some((task) => task.status === 'pending_manual' || task.status === 'failed'),
  ).length
  const allComplete = sections.length > 0 && sections.every((section) => section.status === 'complete')

  const tag = allComplete
    ? { cls: 'ok', text: '已完成' }
    : board?.job?.status === 'queued' || board?.job?.status === 'running'
      ? { cls: 'run', text: '制作中' }
      : board?.stop != null
        ? { cls: 'warn', text: '已停止' }
        : board?.job?.status === 'failed'
          ? { cls: 'err', text: '失败' }
          : suspendedCount > 0
            ? { cls: 'warn', text: '待人工' }
            : { cls: 'mut', text: '空闲' }
  const emptyTag = board ? { cls: 'mut', text: '空闲' } : { cls: 'mut', text: '加载中' }

  /** 视频/出处页签：本节引用的素材按份分组，段内时间范围可回溯原视频并可回放。 */
  const unitsByAsset = useMemo(() => {
    const map = new Map<string, SourceUnitView[]>()
    for (const unit of content?.units ?? []) {
      const list = map.get(unit.assetId) ?? []
      list.push(unit)
      map.set(unit.assetId, list)
    }
    return [...map.entries()]
  }, [content])

  /** 按课件数据类型分拣 widget（K线 / 练习 / 其余互动）。 */
  const klineWidgets = useMemo(
    () => content?.widgets.filter((widget) => KLINE_TYPES.has(widget.type)) ?? [],
    [content],
  )
  const quizWidgets = useMemo(
    () => content?.widgets.filter((widget) => QUIZ_TYPES.has(widget.type)) ?? [],
    [content],
  )
  const interactiveWidgets = useMemo(
    () =>
      content?.widgets.filter(
        (widget) => !KLINE_TYPES.has(widget.type) && !QUIZ_TYPES.has(widget.type),
      ) ?? [],
    [content],
  )
  const figureMap = useMemo(
    () => new Map((content?.figures ?? []).map((figure) => [figure.id, figure])),
    [content],
  )

  const counts: Record<WorkspaceTabKey, string | null> = {
    outline: sections.length > 0 ? String(sections.length) : null,
    artifact: current ? `${current.products}/9` : null,
    figures:
      content && content.figures.length > 0 ? String(content.figures.length) : null,
    video: content && content.units.length > 0 ? String(content.units.length) : null,
    kline:
      quotes && quotes.stocks.length > 0
        ? String(quotes.stocks.length)
        : klineWidgets.length > 0
          ? String(klineWidgets.length)
          : null,
    quiz: quizWidgets.length > 0 ? String(quizWidgets.length) : null,
    interactive: interactiveWidgets.length > 0 ? String(interactiveWidgets.length) : null,
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => selectTab(value as WorkspaceTabKey)}
      className="ws"
      aria-label="制作工作区"
    >
      <div className="ws-head">
        <div className="ws-title">
          制作工作区
        </div>
        <TabsList className="overflow-x-auto">
          {WORKSPACE_TABS.map((item) => (
            <TabsTrigger key={item.key} value={item.key}>
              <item.icon className="size-3.5" aria-hidden="true" />
              {item.label}
              {counts[item.key] ? <span className="n">{counts[item.key]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="ws-body">
        {error ? (
          <Alert variant="destructive" className="mb-3.5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!board ? (
          <div className="empty">制作台加载中…</div>
        ) : !boardReady ? (
          <div className="empty">还没有节。</div>
        ) : (
          <>
            {boardReady ? (
              <Progress className="ws-prog" value={progressPct} aria-label="课件制作完成进度" />
            ) : null}

            <TabsContent value="artifact" className="mt-0">
              {current ? (
                <>
                  <div className="dh">
                    <b>{current.title}</b>
                    <Badge className={`tag ${runningTask ? 'processing' : current.status === 'complete' ? 'ready' : 'gray'}`}>
                      {runningTask
                        ? `生成中 · 第 ${runningTask.step}/9 步`
                        : sectionStateOf(current)}
                    </Badge>
                    <span className="right">
                      <Button variant="link" size="sm" asChild>
                        <Link href={routes.workbench.preview(courseId, current.sectionId)}>
                        本节预览
                      </Link>
                      </Button>
                    </span>
                  </div>
                  {content ? (
                    <>
                      <DslRenderer content={content} />
                      {content.widgets.length > 0 ? (
                        <div className="media3">
                          {content.widgets.slice(0, 3).map((widget) => (
                            <div className="mcard" key={widget.id}>
                              <div className="mh">
                                <span className="lbl">{widget.type}</span>
                                <span className="grow" />
                                <span className="tag gray">已产出</span>
                              </div>
                              <div className="mb">
                                {widget.code ?? widget.type}
                                <span className="note">{widget.assertions.length} 条断言</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty">本节还没产出。</div>
                  )}
                </>
              ) : (
                <p className="note">还没有节。</p>
              )}
            </TabsContent>

            <TabsContent value="figures" className="mt-0">
              {content && content.figures.length > 0 ? (
                FIGURE_KINDS.map(({ kind, label }) => {
                  const list = content.figures.filter((figure) => figure.kind === kind)
                  if (list.length === 0) return null
                  return (
                    <div key={kind}>
                      <div className="th">
                        {label} <span className="grow" />
                        <span className="tag gray">{list.length}</span>
                      </div>
                      {list.map((figure) => (
                        <FigureCard key={figure.id} figure={figure} />
                      ))}
                    </div>
                  )
                })
              ) : (
                <p className="note">{current ? '本节还没有配图。' : '还没有选中节。'}</p>
              )}
            </TabsContent>

            <TabsContent value="video" className="mt-0">
              {current ? (
                unitsByAsset.length > 0 ? (
                  unitsByAsset.map(([assetId, units]) => (
                    <div key={assetId} style={{ marginBottom: 12 }}>
                      <div className="th">
                        <b>{assetNames.get(assetId) ?? assetId}</b>
                        <span className="grow" />
                        <span className="tag gray">{units.length} 段</span>
                      </div>
                      {units.map((unit) => (
                        <ClipCard
                          key={unit.id}
                          assetId={assetId}
                          from={Math.round(unit.startMs / 1000)}
                          to={Math.round(unit.endMs / 1000)}
                          caption={unit.teachingPoints[0] ?? unit.text.slice(0, 40)}
                          unit={unit}
                        />
                      ))}
                    </div>
                  ))
                ) : (
                  <p className="note">本节还没有引用素材片段。</p>
                )
              ) : (
                <p className="note">还没有选中节。</p>
              )}
            </TabsContent>

            <TabsContent value="kline" className="mt-0">
              {current ? (
                <>
                  <div className="th">
                    案例股行情 <span className="grow" />
                    {syncing ? (
                      <span className="tag run">同步中…</span>
                    ) : (
                      <Button variant="link" size="sm" onClick={onSyncQuotes}>
                        同步行情
                      </Button>
                    )}
                  </div>
                  {quotes && quotes.stocks.length > 0 ? (
                    quotes.stocks.map((stock) => (
                      <div key={stock.id} style={{ marginBottom: 14 }}>
                        <div className="th">
                          <b>
                            {stock.name} {stock.code}
                          </b>
                          <span className="grow" />
                          <span className="tag gray">
                            {stock.period === '1w' ? '周线' : '日线'} · {stock.windowStart} ~ {stock.windowEnd}
                          </span>
                        </div>
                        <KlineChart stock={stock} />
                      </div>
                    ))
                  ) : (
                    <p className="note">本节还没有案例股行情。</p>
                  )}
                  {content && klineWidgets.length > 0 ? (
                    <>
                      <div className="th">
                        K 线课件 <span className="grow" />
                        <span className="tag gray">{klineWidgets.length}</span>
                      </div>
                      {klineWidgets.map((widget) => (
                        <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                      ))}
                    </>
                  ) : null}
                </>
              ) : (
                <p className="note">还没有选中节。</p>
              )}
            </TabsContent>

            <TabsContent value="quiz" className="mt-0">
              {content && quizWidgets.length > 0 ? (
                quizWidgets.map((widget) => (
                  <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                ))
              ) : (
                <p className="note">{current ? '本节还没有练习题。' : '还没有选中节。'}</p>
              )}
            </TabsContent>

            <TabsContent value="interactive" className="mt-0">
              {content && interactiveWidgets.length > 0 ? (
                interactiveWidgets.map((widget) => (
                  <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                ))
              ) : (
                <p className="note">
                  {current ? '本节还没有其他互动课件。' : '还没有选中节。'}
                </p>
              )}
            </TabsContent>

            <TabsContent value="outline" className="mt-0">
              <div className="th">
                大纲 <span className="grow" />
                <span className="tag gray">
                  {sections.filter((s) => s.status === 'complete').length}/{sections.length} 完成
                </span>
              </div>
              {sections.map((section) => {
                const suspended = section.tasks.some(
                  (task) => task.status === 'pending_manual' || task.status === 'failed',
                )
                return (
                  <div key={section.sectionId}>
                    <button
                      type="button"
                      className={`tnode ${section.sectionId === currentId ? 'on' : ''}`}
                      onClick={() => onSelectSection(section.sectionId)}
                    >
                      <span className="tt">
                        <b>{section.title}</b>
                        <small>
                          {sectionStateOf(section)} · {section.products}/9 步
                        </small>
                        <span className="steps mini" style={{ marginTop: 6 }}>
                          {section.tasks.map((task) => (
                            <span key={task.step} className={`s ${stepClass(task.status)}`} />
                          ))}
                        </span>
                      </span>
                    </button>
                    {suspended ? (
                      <div className="tnode-acts">
                        <Button
                          variant="link" size="sm"
                          disabled={busy}
                          onClick={() => onRetry(section.sectionId)}
                        >
                          重试该节
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </TabsContent>
          </>
        )}
      </div>
    </Tabs>
  )
}
