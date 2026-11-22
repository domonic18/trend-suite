'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ProductionBoardView,
  ProductionEventView,
  ProductionSectionRow,
  SectionContentView,
} from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '@/features/pipeline/api'
import { DslRenderer } from '@/features/content/ui/DslRenderer'
import {
  getProductionBoard,
  getProductionStream,
  getSectionContent,
  resumeProduction as resumeProductionApi,
  retryProductionSection,
  stopProduction as stopProductionApi,
} from '../api'
import { AgentStream } from './AgentStream'
import { SectionQuotesPanel } from './SectionQuotesPanel'

/**
 * 课件制作台（教师端需求 T21）：对齐原型 docs/prototype/teacher-studio.html 的
 * 「课件制作」屏——左栏课时树（九格进度）、中栏当前节工作区（正文 + 产物 +
 * 引用素材）、右栏 Agent 对话流。
 *
 * 停止制作是**步边界**安全中止：成果保留、回灌预算保留、改完可继续。
 */

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
  canControl = false,
}: {
  courseId: string
  /** producer/admin 可停止/继续（operator 只读）；所有权由服务端把关。 */
  canControl?: boolean
}) {
  const [board, setBoard] = useState<ProductionBoardView | null>(null)
  const [events, setEvents] = useState<ProductionEventView[]>([])
  // 游标放 ref：轮询回调保持稳定身份，不会因为游标推进而重建定时器。
  const cursorRef = useRef<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const [pinned, setPinned] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [content, setContent] = useState<SectionContentView | null>(null)
  const [assetNames, setAssetNames] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBoard = useCallback(async () => {
    try {
      setBoard(await getProductionBoard(courseId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '制作台加载失败')
    }
  }, [courseId])

  const refreshStream = useCallback(async () => {
    try {
      const stream = await getProductionStream(courseId, cursorRef.current)
      if (stream.events.length > 0) {
        setEvents((prev) => [...prev, ...stream.events].slice(-500))
      }
      cursorRef.current = stream.cursor
      setStopped(stream.stopped)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '制作过程加载失败')
    }
  }, [courseId])

  useEffect(() => {
    void refreshBoard()
    void refreshStream()
  }, [refreshBoard, refreshStream])

  useEffect(() => {
    void listAssets(courseId)
      .then((assets) => setAssetNames(new Map(assets.map((asset) => [asset.id, asset.fileName]))))
      .catch(() => undefined)
  }, [courseId])

  const job = board?.job ?? null
  const running =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    (board?.sections ?? []).some((section) =>
      section.tasks.some((task) => task.status === 'running'),
    )
  /** 停止请求下达后到 worker 走到步边界之间，job 仍是 running——那段时间按「已停止」呈现。 */
  const inFlight = running && !stopped

  useEffect(() => {
    const timer = setInterval(() => void refreshBoard(), 3_000)
    return () => clearInterval(timer)
  }, [refreshBoard])

  useEffect(() => {
    const timer = setInterval(() => void refreshStream(), 2_500)
    return () => clearInterval(timer)
  }, [refreshStream])

  /** 当前展示的节：默认跟随正在跑的那节，教师点选后钉住。 */
  const activeSectionId = useMemo(() => {
    const sections = board?.sections ?? []
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
    () => (board?.sections ?? []).find((section) => section.sectionId === currentId) ?? null,
    [board, currentId],
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

  const stop = useCallback(async () => {
    setBusy(true)
    try {
      await stopProductionApi(courseId)
      setStopped(true)
      await refreshBoard()
      await refreshStream()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '停止失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }, [courseId, refreshBoard, refreshStream])

  const resume = useCallback(async () => {
    setBusy(true)
    try {
      await resumeProductionApi(courseId)
      setStopped(false)
      await refreshBoard()
      await refreshStream()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '继续失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }, [courseId, refreshBoard, refreshStream])

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

  const doneSteps = (board?.sections ?? []).reduce((sum, section) => sum + section.products, 0)
  const totalSteps = (board?.sections ?? []).length * 9
  const runningTask = current?.tasks.find((task) => task.status === 'running') ?? null

  if (!board) {
    return (
      <section>
        {error ? <div className="notice err">{error}</div> : null}
        <div className="empty">制作台加载中…</div>
      </section>
    )
  }

  if (board.sections.length === 0) {
    return (
      <section>
        {error ? <div className="notice err">{error}</div> : null}
        <div className="empty">还没有节——批准课程方案后按目录播种。</div>
      </section>
    )
  }

  return (
    <div className="studio">
      <div className="ops-ph">
        <div>
          <div className="t">课件制作</div>
          <div className="s">
            九步生产逐节进行；随时可以停下来改内容，改完继续——已完成的步不重跑。
          </div>
        </div>
        <div className="a">
          <span className="meta">
            {board.sections.length} 节 · {doneSteps}/{totalSteps} 步
          </span>
          {running && !stopped ? (
            <button type="button" className="btn" disabled={busy || !canControl} onClick={() => void stop()}>
              {busy ? '停止中…' : '停止制作'}
            </button>
          ) : stopped ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || !canControl}
              onClick={() => void resume()}
            >
              {busy ? '继续中…' : '继续制作'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="notice err">{error}</div> : null}
      {job?.status === 'failed' ? (
        <div className="notice err">生产任务失败：{job.errorMessage ?? job.errorCode ?? '未知原因'}</div>
      ) : null}

      <div className="studio-split">
        <div className="studio-tree">
          <div className="th">
            课时 <span className="grow" />
            <span className="tag gray">
              {board.sections.filter((s) => s.status === 'complete').length}/{board.sections.length} 完成
            </span>
          </div>
          {board.sections.map((section) => {
            const suspended = section.tasks.some(
              (task) => task.status === 'pending_manual' || task.status === 'failed',
            )
            const isOpen = expanded === section.sectionId
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
                    <button
                      type="button"
                      className="btn link"
                      onClick={() => setExpanded(isOpen ? null : section.sectionId)}
                    >
                      {isOpen ? '收起产物' : '产物'}
                    </button>
                  </div>
                ) : null}
                {isOpen ? (
                  <div className="sdetail">
                    <SectionQuotesPanel courseId={courseId} sectionId={section.sectionId} canResync={canControl} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="studio-work">
          <div className="runbar">
            <span className={`pulse ${inFlight ? 'on' : ''}`} />
            <b>
              {current
                ? `${current.title} · ${
                    runningTask
                      ? `正在第 ${runningTask.step} 步「${runningTask.label}」`
                      : sectionStateOf(current)
                  }`
                : '尚未开跑'}
            </b>
            <span className="grow" />
            <span className="note">
              {current ? `${current.products}/9 步` : ''}
              {content && content.units.length > 0
                ? ` · ${content.units.length} 段出处`
                : ''}
            </span>
          </div>

          <div className="doc">
            {current ? (
              <div className="dh">
                <b>{current.title}</b>
                <span className={`tag ${inFlight ? 'processing' : current.status === 'complete' ? 'ready' : 'gray'}`}>
                  {inFlight ? '生成中' : sectionStateOf(current)}
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
            ) : null}
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
          </div>

          {content && content.units.length > 0 ? (
            <div className="ops-card" style={{ marginTop: 12 }}>
              <div className="h">
                <div>
                  <b>本节引用的素材</b>
                  <small>每个事实段都能回溯到原视频的哪几分钟</small>
                </div>
                <span className="tag gray">
                  {new Set(content.units.map((unit) => unit.assetId)).size} 份素材 ·{' '}
                  {content.units.length} 段出处
                </span>
              </div>
              <div className="b" style={{ paddingTop: 8 }}>
                {content.units.map((unit) => (
                  <div className="unit-line" key={unit.id}>
                    <span className="ts">
                      {clockOf(unit.startMs)}–{clockOf(unit.endMs)}
                    </span>
                    <span className="fn">{assetNames.get(unit.assetId) ?? unit.assetId}</span>
                    <span className="note">
                      {unit.teachingPoints.slice(0, 2).join(' · ') || unit.text.slice(0, 60)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <AgentStream
          events={events}
          stopped={stopped}
          stop={board.stop}
          current={current}
          running={running}
          busy={busy}
          onResume={() => void resume()}
          onStop={() => void stop()}
          canControl={canControl}
        />
      </div>
    </div>
  )
}
