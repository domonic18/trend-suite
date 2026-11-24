'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  ProductionBoardView,
  ProductionSectionRow,
  SectionContentView,
  SourceUnitView,
} from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '@/features/pipeline/api'
import { AgentChat } from '@/features/agent-chat/AgentChat'
import { useAgentStream } from '@/features/agent-chat/useAgentStream'
import { useWsDrag } from '@/features/agent-chat/useWsDrag'
import { ClipCard } from '@/features/content/ui/ClipCard'
import { DslRenderer } from '@/features/content/ui/DslRenderer'
import { FigureCard } from '@/features/content/ui/FigureCard'
import { WidgetHost } from '@/features/content/ui/widgets/WidgetHost'
import type { FigureView } from '@trend-suite/contracts'
import { getProductionBoard, getSectionContent, retryProductionSection } from '../api'

/**
 * 课件制作台（迭代 11，arch/08 chat-center，教师端需求 T21）：与方案页同一形态——
 * 中栏 = 制作 Agent 的真多轮对话（九步事实与逐节 TODO 卡由 worker 写进对话流，
 * 停止/继续/重试是对话动作，停止后确认卡接续）；右栏 = 页签工作区，按课件数据
 * 类型查看：大纲 / 课件全文 / 配图 / 视频片段 / K线图 / 练习题 / 其他互动
 * （340–680px 可拖拽，顶部不放按钮与横幅——需求 T21）。
 *
 * 停止制作是**步边界**安全中止：成果保留、回灌预算保留、改完可继续。
 */

const TABS = [
  { key: 'outline', label: '大纲' },
  { key: 'artifact', label: '课件' },
  { key: 'figures', label: '配图' },
  { key: 'video', label: '视频' },
  { key: 'kline', label: 'K线图' },
  { key: 'quiz', label: '练习题' },
  { key: 'interactive', label: '互动' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** K 线类课件：K 线标注练习 + 逐根回放决策。 */
const KLINE_TYPES = new Set<string>(['kline-annotator', 'bar-replay-decision'])
/** 练习题类：可作答可判分的测验组件（术语卡也算自测练习）。 */
const QUIZ_TYPES = new Set<string>(['mcq-quiz', 'pattern-quiz', 'calc-trainer', 'flashcards'])
/** 其余互动课件归入「互动」。 */

const FIGURE_KINDS: ReadonlyArray<{ kind: FigureView['kind']; label: string }> = [
  { kind: 'keyframe', label: '关键帧' },
  { kind: 'diagram', label: '示意图' },
  { kind: 'generated', label: '装饰图' },
]

function stepClass(status: string): string {
  if (status === 'done') return 'd'
  if (status === 'running') return 'r'
  if (status === 'pending_manual') return 'w'
  if (status === 'failed') return 'e'
  return ''
}

function sectionStateOf(section: ProductionSectionRow): string {
  if (section.status === 'complete') return '已完成'
  if (section.tasks.some((task) => task.status === 'running')) return '进行中'
  if (section.tasks.some((task) => task.status === 'pending_manual' || task.status === 'failed'))
    return '挂起待人工'
  if (section.products > 0) return '推进中'
  return '排队中'
}

export function ProductionStudio({
  courseId,
  courseTitle = null,
  userName = '教师',
}: {
  courseId: string
  courseTitle?: string | null
  userName?: string
}) {
  const [board, setBoard] = useState<ProductionBoardView | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [content, setContent] = useState<SectionContentView | null>(null)
  const [assetNames, setAssetNames] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('artifact')
  const stream = useAgentStream(courseId, 'production')
  const ws = useWsDrag()

  const refreshBoard = useCallback(async () => {
    try {
      setBoard(await getProductionBoard(courseId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '制作台加载失败')
    }
  }, [courseId])

  useEffect(() => {
    void refreshBoard()
  }, [refreshBoard])

  useEffect(() => {
    void listAssets(courseId)
      .then((assets) => setAssetNames(new Map(assets.map((asset) => [asset.id, asset.fileName]))))
      .catch(() => undefined)
  }, [courseId])

  const job = board?.job ?? null
  const sections = board?.sections ?? []
  const running =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    sections.some((section) => section.tasks.some((task) => task.status === 'running'))
  /** 停止请求下达后到 worker 走到步边界之间，job 仍是 running——那段时间按「已停止」呈现。 */
  const stopped = board?.stop != null
  const inFlight = running && !stopped

  useEffect(() => {
    const timer = setInterval(() => void refreshBoard(), 3_000)
    return () => clearInterval(timer)
  }, [refreshBoard])

  /** 当前展示的节：默认跟随正在跑的那节，教师点选后钉住。 */
  const activeSectionId = useMemo(() => {
    const runningSection = sections.find((section) =>
      section.tasks.some((task) => task.status === 'running'),
    )
    return (
      runningSection?.sectionId ??
      sections.find((section) => section.status !== 'complete')?.sectionId ??
      sections[0]?.sectionId ??
      null
    )
  }, [board])

  const currentId = pinned ?? activeSectionId
  const current = useMemo(
    () => sections.find((section) => section.sectionId === currentId) ?? null,
    [sections, currentId],
  )

  // 正文随生产实时刷新：节产物数或正文状态一变就重取。
  const contentSig = current ? `${current.sectionId}:${current.products}:${current.bodyStatus}` : ''
  useEffect(() => {
    if (!currentId) {
      setContent(null)
      return
    }
    let stale = false
    void getSectionContent(courseId, currentId)
      .then((value) => {
        if (!stale) setContent(value)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [courseId, currentId, contentSig])

  const retry = useCallback(
    async (sectionId: string) => {
      setBusy(true)
      try {
        await retryProductionSection(courseId, sectionId)
        await refreshBoard()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '重试失败，请稍后再试')
      } finally {
        setBusy(false)
      }
    },
    [courseId, refreshBoard],
  )

  const doneSteps = sections.reduce((sum, section) => sum + section.products, 0)
  const totalSteps = sections.length * 9
  const progressPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0
  const suspendedCount = sections.filter((section) =>
    section.tasks.some((task) => task.status === 'pending_manual' || task.status === 'failed'),
  ).length
  const allComplete = sections.length > 0 && sections.every((section) => section.status === 'complete')
  const runningTask = current?.tasks.find((task) => task.status === 'running') ?? null

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

  // 状态只落在页签区的标题标（需求 T21：页签工作区顶部不放按钮、横幅与运行条）。
  const tag = allComplete
    ? { cls: 'ok', text: '已完成' }
    : inFlight
      ? { cls: 'run', text: '制作中' }
      : stopped
        ? { cls: 'warn', text: '已停止' }
        : job?.status === 'failed'
          ? { cls: 'err', text: '失败' }
          : suspendedCount > 0
            ? { cls: 'warn', text: '待人工' }
            : { cls: 'mut', text: '空闲' }

  const counts: Record<TabKey, string | null> = {
    outline: sections.length > 0 ? String(sections.length) : null,
    artifact: current ? `${current.products}/9` : null,
    figures:
      content && content.figures.length > 0 ? String(content.figures.length) : null,
    video: content && content.units.length > 0 ? String(content.units.length) : null,
    kline: klineWidgets.length > 0 ? String(klineWidgets.length) : null,
    quiz: quizWidgets.length > 0 ? String(quizWidgets.length) : null,
    interactive: interactiveWidgets.length > 0 ? String(interactiveWidgets.length) : null,
  }

  if (!board) {
    return (
      <section>
        {error ? <div className="notice err">{error}</div> : null}
        <div className="empty">制作台加载中…</div>
      </section>
    )
  }

  if (sections.length === 0) {
    return (
      <section>
        {error ? <div className="notice err">{error}</div> : null}
        <div className="empty">还没有节——批准课程方案后按目录播种。</div>
      </section>
    )
  }

  return (
    <div
      className="plan-split"
      aria-label="课件制作台"
      {...(ws.width != null ? { style: { '--ws-w': `${ws.width}px` } as CSSProperties } : {})}
    >
      <AgentChat
        stream={stream}
        crumb={`${courseTitle ?? '课程'} / 制作台`}
        subtitle="制作阶段 · 九步生产 / 停止继续"
        userName={userName}
        draftingLabel={inFlight ? `正在逐节制作（已完成 ${doneSteps}/${totalSteps} 步）…` : null}
        liveLabel="制作中"
        emptyHint="还没有对话——九步生产的每一步事实会自动留在这里；也可以直接吩咐 Agent 停止、继续或重试。"
        quickChips={['看看现在做到哪了', '停止制作', '继续制作', '重试挂起的节']}
      />
      <div className="wb-col" ref={ws.ref}>
        <div className="ws-drag" onPointerDown={ws.onPointerDown} aria-hidden="true" />
        <div className="ws" aria-label="制作工作区">
          <div className="ws-head">
            <div className="ws-title">
              制作工作区
              <span className={`tag ${tag.cls}`}>{tag.text}</span>
              <span className="grow" />
              <span className="ws-meta">
                {sections.length} 节 · {doneSteps}/{totalSteps} 步 · {progressPct}%
              </span>
            </div>
            <div className="prog ws-prog" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label="课件制作完成进度">
              <i style={{ width: `${progressPct}%` }} />
            </div>
            <div className="ctabs" role="tablist">
              {TABS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={tab === item.key ? 'on' : ''}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                  {counts[item.key] ? <span className="n">{counts[item.key]}</span> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="ws-body">
            <div className={`ctpane${tab === 'artifact' ? ' on' : ''}`}>
              {current ? (
                <>
                  <div className="dh">
                    <b>{current.title}</b>
                    <span className={`tag ${inFlight ? 'processing' : current.status === 'complete' ? 'ready' : 'gray'}`}>
                      {runningTask
                        ? `生成中 · 第 ${runningTask.step}/9 步`
                        : sectionStateOf(current)}
                    </span>
                    <span className="right">
                      <Link
                        className="btn link"
                        href={`/workbench/courses/${courseId}/production/sections/${current.sectionId}/preview`}
                      >
                        本节预览
                      </Link>
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
                    <div className="empty">本节还没产出——正文步完成后这里会实时显示。</div>
                  )}
                </>
              ) : (
                <p className="note">还没有节——批准课程方案后按目录播种。</p>
              )}
            </div>

            <div className={`ctpane${tab === 'figures' ? ' on' : ''}`}>
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
                <p className="note">
                  {current
                    ? '本节还没有配图——图示步完成后这里按 关键帧 / 示意图 / 装饰图 分类列出。'
                    : '选一节后查看它的配图。'}
                </p>
              )}
            </div>

            <div className={`ctpane${tab === 'video' ? ' on' : ''}`}>
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
                  <p className="note">
                    本节还没有引用素材片段——出处步完成后这里按素材列出可回放的视频片段。
                  </p>
                )
              ) : (
                <p className="note">选一节后查看并回放它引用的视频片段。</p>
              )}
            </div>

            <div className={`ctpane${tab === 'kline' ? ' on' : ''}`}>
              {content && klineWidgets.length > 0 ? (
                <>
                  {content.caseStocks.length > 0 ? (
                    <div className="th">
                      案例股 <span className="grow" />
                      <span className="tag gray">
                        {content.caseStocks.map((stock) => `${stock.name} ${stock.code}`).join(' · ')}
                      </span>
                    </div>
                  ) : null}
                  {klineWidgets.map((widget) => (
                    <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                  ))}
                </>
              ) : (
                <p className="note">
                  {current
                    ? '本节还没有 K 线类课件——行情同步 / 逐根回放步完成后这里列出 K 线标注与回放练习。'
                    : '选一节后查看它的 K 线课件。'}
                </p>
              )}
            </div>

            <div className={`ctpane${tab === 'quiz' ? ' on' : ''}`}>
              {content && quizWidgets.length > 0 ? (
                quizWidgets.map((widget) => (
                  <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                ))
              ) : (
                <p className="note">
                  {current
                    ? '本节还没有练习题——课件步完成后这里列出选择 / 形态 / 计算练习。'
                    : '选一节后查看它的练习题。'}
                </p>
              )}
            </div>

            <div className={`ctpane${tab === 'interactive' ? ' on' : ''}`}>
              {content && interactiveWidgets.length > 0 ? (
                interactiveWidgets.map((widget) => (
                  <WidgetHost key={widget.id} widget={widget} figures={figureMap} />
                ))
              ) : (
                <p className="note">
                  {current
                    ? '本节还没有其他互动课件——分步解盘 / 检查清单 / 决策情景等会出现在这里。'
                    : '选一节后查看它的互动课件。'}
                </p>
              )}
            </div>

            <div className={`ctpane${tab === 'outline' ? ' on' : ''}`}>
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
                      onClick={() => setPinned(section.sectionId)}
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
                        <button
                          type="button"
                          className="btn link"
                          disabled={busy}
                          onClick={() => void retry(section.sectionId)}
                        >
                          重试该节
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
