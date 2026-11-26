'use client'

import { useState } from 'react'
import type { PlanJobView, PlanReviewView, PlanView, TweakPlanRequest } from '@trend-suite/contracts'
import { classifyDraftFailure } from './draftFailure'
import { OutlineTree } from './OutlineTree'

/**
 * 方案页右栏课件工作区（arch/08 §6）：页签统一为**课件元素类别**（大纲 /
 * 课件 / 配图 / 视频 / K线图 / 练习题 / 互动，与制作台同构）——教师从方案
 * 阶段看到的就是最终课件的元素维度；方案阶段只有大纲（骨架树），其余元素
 * 批准制作后逐节生成。微调即时生效、不进对话；不放横幅与动作按钮。
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

/** 课件元素在方案阶段的空态（最小状态句，无教学标注）。 */
const PENDING_TEXT: Record<Exclude<TabKey, 'outline'>, string> = {
  artifact: '还没有课件。',
  figures: '还没有配图。',
  video: '还没有视频。',
  kline: '还没有 K 线图。',
  quiz: '还没有练习题。',
  interactive: '还没有互动课件。',
}

export function PlanWorkspace({
  plan,
  job,
  review,
  busy,
  error,
  notice,
  onTweak,
}: {
  plan: PlanView | null
  job: PlanJobView | null
  review: PlanReviewView | null
  busy: boolean
  error: string | null
  notice: string | null
  onTweak: (op: TweakPlanRequest) => void
}) {
  const [tab, setTab] = useState<TabKey>('outline')

  const running = job?.status === 'queued' || job?.status === 'running'
  const approved = plan?.status === 'approved'
  const jobFailed = !plan && job?.status === 'failed'
  const failure = jobFailed ? classifyDraftFailure(job) : null

  const tag = approved
    ? { cls: 'ok', text: '已锁定' }
    : running
      ? { cls: 'run', text: '起草中' }
      : plan
        ? { cls: 'warn', text: '待批准' }
        : { cls: 'mut', text: '未起草' }

  const counts: Record<TabKey, string | null> = {
    outline: plan ? String(plan.skeleton.nodes.length) : null,
    artifact: null,
    figures: null,
    video: null,
    kline: null,
    quiz: null,
    interactive: null,
  }

  return (
    <div className="ws" aria-label="课件工作区">
      <div className="ws-head">
        <div className="ws-title">
          课件工作区
          <span className={`tag ${tag.cls}`}>{tag.text}</span>
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
        <div className={`ctpane${tab === 'outline' ? ' on' : ''}`}>
          {error ? <div className="notice err">{error}</div> : null}
          {notice ? <div className="notice warn">{notice}</div> : null}

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

          {plan ? (
            <>
              {plan.violations.length > 0 ? (
                <details className="toolcard">
                  <summary>
                    <span className="tname">校验口径与拒绝记录</span>
                    <span className="targs">{plan.violations.length} 条</span>
                  </summary>
                  <div className="tout">
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
                </details>
              ) : null}
              <OutlineTree
                nodes={plan.skeleton.nodes}
                lessons={plan.sectionPlan.lessons}
                coverage={plan.coverage}
                busy={busy}
                onRename={(nodeId, title) => onTweak({ op: 'rename_chapter', nodeId, title })}
                onRemove={(nodeId) => onTweak({ op: 'remove_chapter', nodeId })}
                onAdd={(parentId, title) => onTweak({ op: 'add_chapter', parentId, title })}
                onMove={(nodeId, newParentId, position) =>
                  onTweak({ op: 'move_node', nodeId, newParentId, position })
                }
                onSetGranularity={(lessonId, subLessonCount) =>
                  onTweak({ op: 'set_granularity', lessonId, subLessonCount })
                }
              />
            </>
          ) : failure ? (
            <p className="note">{failure.text}</p>
          ) : (
            <p className="note">还没有方案。</p>
          )}
        </div>

        {TABS.filter((item) => item.key !== 'outline').map((item) => (
          <div className={`ctpane${tab === item.key ? ' on' : ''}`} key={item.key}>
            <p className="note">{PENDING_TEXT[item.key]}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
