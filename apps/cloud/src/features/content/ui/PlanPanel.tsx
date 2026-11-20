'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlanResponse, TweakPlanRequest } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { approvePlan, getPlan, rejectPlan, tweakPlan } from '../api'
import { NextActionBanner } from './NextActionBanner'
import { AgentRail } from './AgentRail'
import { classifyDraftFailure } from './draftFailure'
import { OutlineCard } from './OutlineCard'
import { PlanDraftForm } from './PlanDraftForm'
import { InterruptCard } from './InterruptCard'
import { ToolCards } from './ToolCards'

export type MaterialsReady = { ready: number; total: number }

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * 方案面板（迭代 3）：提交目标与目录 → 队列起草 → 批准/微调/打回。
 * 起草中每 3 秒轮询（复用素材面板节奏），未决项由服务端兜底（409）。
 * 顶部常驻下一步引导横幅（原型 nextaction）：每个状态都回答「现在该干什么」。
 */
export function PlanPanel({
  courseId,
  materials = null,
  userName = '教师',
}: {
  courseId: string
  materials?: MaterialsReady | null
  userName?: string
}) {
  const router = useRouter()
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
  const review = data?.review ?? null
  const lowMatchCount = plan ? plan.skeleton.nodes.filter((n) => n.matchStatus === 'low_match').length : 0
  // 已自动处理的拒绝记录（剔除 / 还原 / 裁剪）只留痕，不阻塞批准。
  const violationCount = plan ? plan.violations.filter((v) => !v.resolved).length : 0
  const approved = plan?.status === 'approved'
  const blocked = lowMatchCount > 0 || violationCount > 0
  const jobFailed = !plan && job?.status === 'failed'
  const failure = jobFailed ? classifyDraftFailure(job) : null
  const matText = materials ? `基于 ${materials.ready}/${materials.total} 份就绪素材` : ''

  function tweak(op: TweakPlanRequest) {
    void act(() => tweakPlan(courseId, op))
  }

  if (loading) {
    return <div className="empty">方案加载中…</div>
  }

  return (
    <div className="plan-split">
      <section>
      {running ? (
        <NextActionBanner tone="info">
          Agent 正在起草方案{matText ? `（${matText}）` : ''}…第 {job?.attempts ?? 1} 次尝试；草案四件套产出后自动呈现，等待期间可去
          「上传与转写」核对逐字稿与关键帧。
        </NextActionBanner>
      ) : null}
      {failure ? (
        <NextActionBanner
          tone="warn"
          {...(failure.action
            ? { action: { label: failure.action.label, onClick: () => scrollToId('plan-form') } }
            : {})}
        >
          {failure.text}
        </NextActionBanner>
      ) : null}
      {review && review.status === 'manual' ? (
        <NextActionBanner tone="warn" action={{ label: '去修改重提', onClick: () => scrollToId('plan-form') }}>
          规划自检连续 {review.attempts} 次未通过，方案没有呈现给你——修掉下面的问题后可重新提交。
        </NextActionBanner>
      ) : null}
      {review && review.status === 'manual' ? (
        <div className="card">
          <div className="card-top">
            <b>自检未通过</b>
            <span className="meta">{review.issues.length} 项</span>
          </div>
          <ul className="viol-list">
            {review.issues.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>
                <b>{issue.subject}</b>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan && approved ? (
        <NextActionBanner
          tone="ok"
          action={{ label: '打开九步生产', href: `/workbench/courses/${courseId}/production` }}
        >
          方案 v{plan.version} 已锁定为基准版，逐节生产已解锁。
        </NextActionBanner>
      ) : null}
      {plan && !approved && blocked ? (
        <NextActionBanner tone="warn" action={{ label: '去裁决', onClick: () => scrollToId('plan-outline') }}>
          {lowMatchCount} 章证据不足、{violationCount} 条拒绝记录——在大纲中改名 / 删除 / 合并裁决后才能批准。
        </NextActionBanner>
      ) : null}
      {plan && !approved && !blocked ? (
        <NextActionBanner tone="ok" action={{ label: '去批准', onClick: () => scrollToId('plan-interrupt') }}>
          方案四件套齐全（v{plan.version}），可批准锁定为基准版。
        </NextActionBanner>
      ) : null}
      {!plan && !running && !jobFailed ? (
        <NextActionBanner tone="info">
          第 1 步：提交课程目标（人工目录可留空，由 Agent 代拟）——Agent 依据目标与已就绪素材起草方案，
          目录外的内容不会创建章节。
        </NextActionBanner>
      ) : null}

      {error ? <div className="notice err">{error}</div> : null}

      {!plan && !running ? (
        <div id="plan-form">
          <PlanDraftForm
            courseId={courseId}
            initial={data?.input ?? null}
            materials={materials}
            courseMaterials={data?.materials ?? []}
            onSubmitted={refresh}
          />
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="page-head" style={{ marginTop: 8 }}>
            <div>
              <h2>方案概览</h2>
              <p className="sub">
                v{plan.version} · {approved ? '已批准（基准版）' : '草案'} ·{' '}
                {plan.origin === 'revision'
                  ? '打回重起草'
                  : plan.origin === 'tweak'
                    ? '微调生成'
                    : '首次起草'}
                {review && review.status === 'pass'
                  ? ` · 自检通过（第 ${review.attempts} 次尝试）`
                  : ''}
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
            <PlanDraftForm
              courseId={courseId}
              initial={data?.input ?? null}
              materials={materials}
              courseMaterials={data?.materials ?? []}
              onSubmitted={refresh}
            />
          ) : null}

          <OutlineCard
            nodes={plan.skeleton.nodes}
            coverage={plan.coverage}
            busy={busy}
            onRename={(nodeId, title) => tweak({ op: 'rename_chapter', nodeId, title })}
            onRemove={(nodeId) => tweak({ op: 'remove_chapter', nodeId })}
            onMerge={(nodeIds, title) => tweak({ op: 'merge_chapters', nodeIds, title })}
            onAdd={(parentId, title) => tweak({ op: 'add_chapter', parentId, title })}
            onMove={(nodeId, newParentId, position) =>
              tweak({ op: 'move_node', nodeId, newParentId, position })
            }
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
                    {violation.resolved ? <span className="tag ok">已自动处理</span> : null}
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
            onReorderLessons={(lessonIds) => tweak({ op: 'reorder_lessons', lessonIds })}
          />

          <InterruptCard
            lowMatchCount={lowMatchCount}
            violationCount={violationCount}
            canApprove={lowMatchCount === 0 && violationCount === 0}
            busy={busy}
            onGoOutline={() => scrollToId('plan-outline')}
            onApprove={() =>
              void act(async () => {
                await approvePlan(courseId)
                router.push(`/workbench/courses/${courseId}/production`)
              })
            }
            onReject={(feedback) => void act(() => rejectPlan(courseId, feedback))}
          />
        </>
      ) : null}
      </section>
      <AgentRail
        trace={data?.trace ?? null}
        job={job}
        plan={plan}
        userName={userName}
        busy={busy}
        onSend={(text) => void act(() => rejectPlan(courseId, text))}
      />
    </div>
  )
}
