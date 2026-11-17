'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PlanResponse, TweakPlanRequest } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { approvePlan, getPlan, rejectPlan, tweakPlan } from '../api'
import { OutlineCard } from './OutlineCard'
import { PlanDraftForm } from './PlanDraftForm'
import { InterruptCard } from './InterruptCard'
import { ToolCards } from './ToolCards'

/**
 * 方案面板（迭代 3）：提交目标与目录 → 队列起草 → 批准/微调/打回。
 * 起草中每 3 秒轮询（复用素材面板节奏），未决项由服务端兜底（409）。
 */
export function PlanPanel({ courseId }: { courseId: string }) {
  const [data, setData] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingInput, setEditingInput] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setData(await getPlan(courseId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '方案加载失败')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const job = data?.job ?? null
  const running = job?.status === 'queued' || job?.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [running, refresh])

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await fn()
        await refresh()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '操作失败，请稍后再试')
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const plan = data?.plan ?? null
  const lowMatchCount = plan ? plan.skeleton.nodes.filter((n) => n.matchStatus === 'low_match').length : 0
  const violationCount = plan ? plan.violations.length : 0

  function tweak(op: TweakPlanRequest) {
    void act(() => tweakPlan(courseId, op))
  }

  if (loading) {
    return <div className="empty">方案加载中…</div>
  }

  return (
    <section>
      {error ? <div className="notice err">{error}</div> : null}
      {running ? (
        <div className="notice">
          正在起草方案（{job?.status === 'queued' ? '排队中' : '进行中'}）…第 {job?.attempts ?? 1} 次尝试
        </div>
      ) : null}
      {job?.status === 'failed' ? (
        <div className="notice err">
          起草失败：{job.errorMessage ?? job.errorCode ?? '未知原因'}
        </div>
      ) : null}

      {!plan && !running ? (
        <PlanDraftForm courseId={courseId} initial={data?.input ?? null} onSubmitted={refresh} />
      ) : null}

      {plan ? (
        <>
          <div className="page-head" style={{ marginTop: 8 }}>
            <div>
              <h2>课程大纲</h2>
              <p className="sub">
                v{plan.version} · {plan.status === 'approved' ? '已批准（基准版）' : '草案'} ·{' '}
                {plan.origin === 'revision'
                  ? '打回重起草'
                  : plan.origin === 'tweak'
                    ? '微调生成'
                    : '首次起草'}
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setEditingInput((v) => !v)}
              >
                {editingInput ? '收起目标与目录' : '改目标与目录'}
              </button>
            </div>
          </div>

          {editingInput ? (
            <PlanDraftForm courseId={courseId} initial={data?.input ?? null} onSubmitted={refresh} />
          ) : null}

          <OutlineCard
            nodes={plan.skeleton.nodes}
            busy={busy}
            onRename={(nodeId, title) => tweak({ op: 'rename_chapter', nodeId, title })}
            onRemove={(nodeId) => tweak({ op: 'remove_chapter', nodeId })}
            onMerge={(nodeIds, title) => tweak({ op: 'merge_chapters', nodeIds, title })}
            onAdd={(parentId, title) => tweak({ op: 'add_chapter', parentId, title })}
          />

          {plan.violations.length > 0 ? (
            <div className="card">
              <div className="card-top">
                <b>拒绝记录</b>
                <span className="meta">{plan.violations.length} 条</span>
              </div>
              <ul className="viol-list">
                {plan.violations.map((violation, index) => (
                  <li key={`${violation.kind}-${violation.subject}-${index}`}>
                    <b>{violation.subject}</b>
                    <span>{violation.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ToolCards
            conceptMap={plan.conceptMap}
            glossary={plan.glossary}
            sectionPlan={plan.sectionPlan}
            busy={busy}
            onSetGranularity={(lessonId, subLessonCount) =>
              tweak({ op: 'set_granularity', lessonId, subLessonCount })
            }
            onAddAlias={(conceptId, alias) => tweak({ op: 'add_alias', conceptId, alias })}
          />

          <InterruptCard
            lowMatchCount={lowMatchCount}
            violationCount={violationCount}
            canApprove={lowMatchCount === 0 && violationCount === 0}
            busy={busy}
            onApprove={() => void act(() => approvePlan(courseId))}
            onReject={(feedback) => void act(() => rejectPlan(courseId, feedback))}
          />
        </>
      ) : null}
    </section>
  )
}
