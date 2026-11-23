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
import { DslRenderer } from '@/features/content/ui/DslRenderer'
import { getProductionBoard, getSectionContent, retryProductionSection } from '../api'

/**
 * 课件制作台（迭代 11，arch/08 chat-center，教师端需求 T21）：与方案页同一形态——
 * 中栏 = 制作 Agent 的真多轮对话（九步事实与逐节 TODO 卡由 worker 写进对话流，
 * 停止/继续/重试是对话动作，停止后确认卡接续）；右栏 = 页签工作区
 * （课件 / 出处 / 行情 / 课时，340–680px 可拖拽，顶部不放按钮与横幅——需求 T21）。
 *
 * 停止制作是**步边界**安全中止：成果保留、回灌预算保留、改完可继续。
 */

const TABS = [
  { key: 'artifact', label: '课件' },
  { key: 'sources', label: '出处' },
  { key: 'sections', label: '课时' },
] as const

type TabKey = (typeof TABS)[number]['key']

function clockOf(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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
  const suspendedCount = sections.filter((section) =>
    section.tasks.some((task) => task.status === 'pending_manual' || task.status === 'failed'),
  ).length
  const allComplete = sections.length > 0 && sections.every((section) => section.status === 'complete')
  const runningTask = current?.tasks.find((task) => task.status === 'running') ?? null

  /** 出处页签：本节引用的素材按份分组，段内时间范围可回溯原视频。 */
  const unitsByAsset = useMemo(() => {
    const map = new Map<string, SourceUnitView[]>()
    for (const unit of content?.units ?? []) {
      const list = map.get(unit.assetId) ?? []
      list.push(unit)
      map.set(unit.assetId, list)
    }
    return [...map.entries()]
  }, [content])

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
    artifact: current ? `${current.products}/9` : null,
    sources: content && content.units.length > 0 ? String(content.units.length) : null,
    sections: sections.length > 0 ? String(sections.length) : null,
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
              {courseTitle ? `${courseTitle} · ` : ''}制作台
              <span className={`tag ${tag.cls}`}>{tag.text}</span>
              <span className="grow" />
              <span className="ws-meta">
                {sections.length} 节 · {doneSteps}/{totalSteps} 步
              </span>
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

            <div className={`ctpane${tab === 'sources' ? ' on' : ''}`}>
              {current ? (
                unitsByAsset.length > 0 ? (
                  unitsByAsset.map(([assetId, units]) => (
                    <div className="ops-card" key={assetId} style={{ marginBottom: 12 }}>
                      <div className="h">
                        <div>
                          <b>{assetNames.get(assetId) ?? assetId}</b>
                          <small>这个素材里的哪些分钟被本节引用</small>
                        </div>
                        <span className="tag gray">{units.length} 段出处</span>
                      </div>
                      <div className="b" style={{ paddingTop: 8 }}>
                        {units.map((unit) => (
                          <div className="unit-line" key={unit.id}>
                            <span className="ts">
                              {clockOf(unit.startMs)}–{clockOf(unit.endMs)}
                            </span>
                            <span className="note">
                              {unit.teachingPoints.slice(0, 2).join(' · ') || unit.text.slice(0, 60)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="note">本节还没有引用素材——出处步完成后这里按素材列出可回溯的分钟段。</p>
                )
              ) : (
                <p className="note">选一节后查看它引用了哪些素材的哪些分钟。</p>
              )}
            </div>

            <div className={`ctpane${tab === 'sections' ? ' on' : ''}`}>
              <div className="th">
                课时 <span className="grow" />
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
