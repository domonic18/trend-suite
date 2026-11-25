'use client'

import { useState } from 'react'
import type {
  AgentMessageView,
  PlanCoverageView,
  PlanJobView,
  PlanReviewView,
  PlanView,
  TweakPlanRequest,
} from '@trend-suite/contracts'
import { classifyDraftFailure } from './draftFailure'
import { OutlineTree } from './OutlineTree'
import { ToolCards } from './ToolCards'

/**
 * 右栏纯产物工作区（arch/08 §2，WorkBuddy 式页签）：大纲 / 术语 / 分节 / 轨迹。
 * 只呈现产物与微调（微调即时生效、不进对话）——所有工作交互都在中栏对话区
 * （自由文本 + AskQuestion 确认卡）。不放状态横幅与「现在该干什么」的引导：
 * 起草进度、批准卡、失败原因都由对话流承载；这里只回答「产物长什么样」。
 */

type MaterialsReady = { ready: number; total: number }

const TABS = [
  { key: 'outline', label: '大纲' },
  { key: 'glossary', label: '术语' },
  { key: 'lessons', label: '分节' },
  { key: 'trace', label: '轨迹' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function PlanWorkspace({
  courseId,
  plan,
  job,
  materials,
  review,
  busy,
  error,
  notice,
  events,
  onTweak,
}: {
  courseId: string
  plan: PlanView | null
  job: PlanJobView | null
  materials: MaterialsReady | null
  review: PlanReviewView | null
  busy: boolean
  error: string | null
  notice: string | null
  /** 对话线程内的系统事件（轨迹页签的事实流）。 */
  events: AgentMessageView[]
  onTweak: (op: TweakPlanRequest) => void
}) {
  const [tab, setTab] = useState<TabKey>('outline')

  const running = job?.status === 'queued' || job?.status === 'running'
  const approved = plan?.status === 'approved'
  const jobFailed = !plan && job?.status === 'failed'
  const failure = jobFailed ? classifyDraftFailure(job) : null

  const nodeTitleById = new Map((plan?.skeleton.nodes ?? []).map((node) => [node.id, node.title]))
  const lessons = plan?.sectionPlan.lessons ?? []
  const glossaryCount = plan?.glossary.items.length ?? 0

  const tag = approved
    ? { cls: 'ok', text: '已锁定' }
    : running
      ? { cls: 'run', text: '起草中' }
      : plan
        ? { cls: 'warn', text: '待批准' }
        : { cls: 'mut', text: '未起草' }

  const counts: Record<TabKey, string | null> = {
    outline: plan ? String(plan.skeleton.nodes.length) : null,
    glossary: plan ? String(glossaryCount) : null,
    lessons: plan ? String(lessons.length) : null,
    trace: events.length > 0 ? String(events.length) : null,
  }

  return (
    <div className="ws" aria-label="方案工作区">
      <div className="ws-head">
        <div className="ws-title">
          方案工作区
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

        <div className={`ctpane${tab === 'glossary' ? ' on' : ''}`}>
          {plan ? (
            <ToolCards
              conceptMap={plan.conceptMap}
              glossary={plan.glossary}
              busy={busy}
              onAddAlias={(conceptId, alias) => onTweak({ op: 'add_alias', conceptId, alias })}
            />
          ) : (
            <p className="note">还没有方案。</p>
          )}
        </div>

        <div className={`ctpane${tab === 'lessons' ? ' on' : ''}`}>
          {plan ? (
            <table className="mini-tbl">
              <thead>
                <tr>
                  <th>课时</th>
                  <th>挂靠章</th>
                  <th>子节</th>
                  <th>估时</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => (
                  <tr key={lesson.id}>
                    <td>{lesson.title}</td>
                    <td>{lesson.sectionId ? (nodeTitleById.get(lesson.sectionId) ?? '—') : '—'}</td>
                    <td>{lesson.subLessonCount}</td>
                    <td>{lesson.estimatedMinutes} 分钟</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="note">还没有方案。</p>
          )}
          {plan?.coverage ? <CoverageNote coverage={plan.coverage} /> : null}        </div>

        <div className={`ctpane${tab === 'trace' ? ' on' : ''}`}>
          {events.length === 0 ? (
            <p className="note">还没有事件。</p>
          ) : (
            events.map((event) =>
              event.role === 'todo' ? (
                <p key={event.id} className="note">{`TODO（${event.items.filter((i) => i.status === 'done').length}/${event.items.length}）：${event.items.map((i) => i.content).join('；')}`}</p>
              ) : event.role === 'event' ? (
                <div key={event.id} className={`ev ${event.level}`}>
                  {event.detail ?? event.kind}
                </div>
              ) : null,
            )
          )}
        </div>
      </div>
    </div>
  )
}

function CoverageNote({ coverage }: { coverage: PlanCoverageView }) {
  return (
    <p className="note" style={{ marginTop: 8 }}>
      素材覆盖率：{coverage.coveredPoints}/{coverage.totalPoints} 条教学要点（
      {Math.round(coverage.ratio * 100)}%）。
    </p>
  )
}

