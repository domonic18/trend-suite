'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import type { ProductionBoardView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getProductionBoard, retryProductionSection } from '../api'
import { SectionQuotesPanel } from './SectionQuotesPanel'

/**
 * 九步生产看板（仿 docs/prototype/teacher-production.html）：
 * 节行 × 9 步格（d=done / r=running / w=pending_manual / e=failed），
 * 生产活跃时 3 秒轮询（复用素材面板节奏）；挂起节带「重试」；
 * 节行可展开「产物」面板看案例股清单与 K 线（迭代 5）。
 */

const STEP_LABELS = ['案例股', '行情同步', '行情读回', '图示', '回放课件', '正文', '其余课件', '评审', '溯源']

function stepClass(status: string): string {
  if (status === 'done') return 'd'
  if (status === 'running') return 'r'
  if (status === 'pending_manual') return 'w'
  if (status === 'failed') return 'e'
  return ''
}

function stepTitle(label: string, status: string, attempts: number, lastError: string | null): string {
  const statusText =
    status === 'done'
      ? '已完成'
      : status === 'running'
        ? '进行中'
        : status === 'pending_manual'
          ? '挂起待人工'
          : status === 'failed'
            ? '失败'
            : '待开始'
  const attempt = attempts > 0 ? ` · 第 ${attempts} 次尝试` : ''
  const err = lastError ? ` · ${lastError}` : ''
  return `${label} · ${statusText}${attempt}${err}`
}

function sectionTag(section: ProductionBoardView['sections'][number]): { className: string; text: string } {
  if (section.status === 'complete') return { className: 'tag ready', text: '已完成' }
  if (section.tasks.some((t) => t.status === 'running')) return { className: 'tag processing', text: '进行中' }
  if (section.tasks.some((t) => t.status === 'pending_manual' || t.status === 'failed'))
    return { className: 'tag draft', text: '挂起待人工' }
  if (section.tasks.some((t) => t.status === 'done')) return { className: 'tag processing', text: '推进中' }
  return { className: 'tag gray', text: '排队中' }
}

export function ProductionBoard({
  courseId,
  canResync = false,
}: {
  courseId: string
  /** producer/admin 可发起「重新同步行情」（operator 只读）；所有权由服务端把关。 */
  canResync?: boolean
}) {
  const [board, setBoard] = useState<ProductionBoardView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySection, setBusySection] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setBoard(await getProductionBoard(courseId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '看板加载失败')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const job = board?.job ?? null
  const active =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    (board?.sections ?? []).some((section) =>
      section.tasks.some((task) => task.status === 'running'),
    )
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [active, refresh])

  const retry = useCallback(
    async (sectionId: string) => {
      setBusySection(sectionId)
      setError(null)
      try {
        await retryProductionSection(courseId, sectionId)
        await refresh()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '重试失败，请稍后再试')
      } finally {
        setBusySection(null)
      }
    },
    [courseId, refresh],
  )

  if (loading) return <div className="empty">看板加载中…</div>
  if (!board) {
    return (
      <section>
        {error ? <div className="notice err">{error}</div> : null}
        <div className="empty">还没有生产看板——批准课程方案后自动起跑。</div>
      </section>
    )
  }

  const totalSteps = board.sections.length * 9
  const doneSteps = board.sections.reduce((sum, section) => sum + section.products, 0)
  const suspendedCount = board.sections.filter((section) =>
    section.tasks.some((t) => t.status === 'pending_manual' || t.status === 'failed'),
  ).length
  const runningCount = board.sections.filter((section) =>
    section.tasks.some((t) => t.status === 'running'),
  ).length

  return (
    <section>
      {error ? <div className="notice err">{error}</div> : null}
      {job?.status === 'failed' ? (
        <div className="notice err">生产任务失败：{job.errorMessage ?? job.errorCode ?? '未知原因'}</div>
      ) : null}
      {active ? (
        <div className="notice">
          生产进行中（{job?.status === 'queued' ? '排队中' : '进行中'}）…本页每 3 秒自动刷新
        </div>
      ) : null}

      <div className="card">
        <div className="card-top">
          <b>生产概览</b>
          <span className="meta">
            {board.sections.length} 节 · {totalSteps} 步
          </span>
        </div>
        <div className="board-summary">
          <span className="tag gray">已完成 {doneSteps} 步</span>
          <span className="tag processing">进行中 {runningCount} 节</span>
          {suspendedCount > 0 ? <span className="tag draft">挂起 {suspendedCount} 节</span> : null}
        </div>
      </div>

      <div className="card">
        <div className="card-top">
          <b>逐节进度</b>
          <span className="meta">每节固定九步，顺序由云端状态机强制</span>
        </div>
        {board.sections.map((section) => {
          const tag = sectionTag(section)
          const retryable = section.tasks.some(
            (t) => t.status === 'pending_manual' || t.status === 'failed',
          )
          const failedTask = section.tasks.find((t) => t.lastError && t.status !== 'done')
          const caseDone = section.tasks.some((t) => t.step === 1 && t.status === 'done')
          const isOpen = expanded === section.sectionId
          return (
            <div className="srow-wrap" key={section.sectionId}>
              <div className="srow">
                <div className="smeta">
                  <b>{section.title}</b>
                  <span>
                    {section.sectionId} · {section.products}/9 步
                  </span>
                </div>
                <div className="steps" aria-label="九步进度">
                  {section.tasks.map((task) => (
                    <span
                      key={task.step}
                      className={`s ${stepClass(task.status)}`}
                      title={stepTitle(STEP_LABELS[task.step - 1] ?? `第 ${task.step} 步`, task.status, task.attempts, task.lastError)}
                    >
                      {task.step}
                    </span>
                  ))}
                </div>
                <div className="sright">
                  <span className={tag.className}>{tag.text}</span>
                  {failedTask?.lastError ? <div className="err-text">{failedTask.lastError}</div> : null}
                  {retryable ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busySection === section.sectionId}
                      onClick={() => void retry(section.sectionId)}
                    >
                      {busySection === section.sectionId ? '重试中…' : '重试该节'}
                    </button>
                  ) : null}
                  {caseDone ? (
                    <button
                      type="button"
                      className="btn link"
                      onClick={() => setExpanded(isOpen ? null : section.sectionId)}
                    >
                      {isOpen ? '收起产物' : '产物'}
                    </button>
                  ) : null}
                  {section.bodyStatus === 'draft' ? (
                    <Link
                      className="btn link"
                      href={`/workbench/courses/${courseId}/production/sections/${section.sectionId}/preview`}
                    >
                      预览
                    </Link>
                  ) : null}
                </div>
              </div>
              {isOpen ? (
                <div className="sdetail">
                  <SectionQuotesPanel courseId={courseId} sectionId={section.sectionId} canResync={canResync} />
                </div>
              ) : null}
            </div>
          )
        })}
        {board.sections.length === 0 ? (
          <div className="empty">还没有节——批准课程方案后按目录播种。</div>
        ) : null}
      </div>
    </section>
  )
}
