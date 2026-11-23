'use client'

import { useState } from 'react'
import type {
  AgentMessageView,
  PlanCoverageView,
  PlanJobView,
  PlanMaterialView,
  PlanReviewView,
  PlanView,
  TweakPlanRequest,
} from '@trend-suite/contracts'
import { NextActionBanner } from './NextActionBanner'
import { classifyDraftFailure } from './draftFailure'
import { OutlineTree } from './OutlineTree'
import { PlanDraftForm } from './PlanDraftForm'
import { ToolCards } from './ToolCards'

/**
 * 右栏产物工作区（arch/08 §2，WorkBuddy 式页签）：大纲 / 术语 / 分节 / 参数 / 轨迹。
 * 内容即产物，微调即时生效、不进对话；需要确认的事以确认卡呈现在中栏对话流。
 * 每个状态在「大纲」页签顶部回答「现在该干什么」（下一步横幅）。
 */

type MaterialsReady = { ready: number; total: number }

const TABS = [
  { key: 'outline', label: '大纲' },
  { key: 'glossary', label: '术语' },
  { key: 'lessons', label: '分节' },
  { key: 'params', label: '参数' },
  { key: 'trace', label: '轨迹' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function PlanWorkspace({
  courseId,
  plan,
  job,
  input,
  courseMaterials,
  materials,
  review,
  busy,
  error,
  notice,
  events,
  onTweak,
  onRefresh,
  onGoChat,
}: {
  courseId: string
  plan: PlanView | null
  job: PlanJobView | null
  input: { goal: string; outlineText: string } | null
  courseMaterials: PlanMaterialView[]
  materials: MaterialsReady | null
  review: PlanReviewView | null
  busy: boolean
  error: string | null
  notice: string | null
  /** 对话线程内的系统事件（轨迹页签的事实流）。 */
  events: AgentMessageView[]
  onTweak: (op: TweakPlanRequest) => void
  onRefresh: () => void
  onGoChat: () => void
}) {
  const [tab, setTab] = useState<TabKey>('outline')

  const running = job?.status === 'queued' || job?.status === 'running'
  const approved = plan?.status === 'approved'
  const lowMatchCount = plan ? plan.skeleton.nodes.filter((n) => n.matchStatus === 'low_match').length : 0
  const violationCount = plan ? plan.violations.filter((v) => !v.resolved).length : 0
  const blocked = lowMatchCount > 0 || violationCount > 0
  const jobFailed = !plan && job?.status === 'failed'
  const failure = jobFailed ? classifyDraftFailure(job) : null
  const matText = materials ? `基于 ${materials.ready}/${materials.total} 份就绪素材` : ''

  const nodeTitleById = new Map((plan?.skeleton.nodes ?? []).map((node) => [node.id, node.title]))
  const lessons = plan?.sectionPlan.lessons ?? []
  const glossaryCount = plan?.glossary.items.length ?? 0

  const tag = approved
    ? { cls: 'ok', text: '已锁定' }
    : running
      ? { cls: 'run', text: '起草中' }
      : plan
        ? blocked
          ? { cls: 'warn', text: '待裁决' }
          : { cls: 'warn', text: '待批准' }
        : { cls: 'mut', text: '未起草' }

  const counts: Record<TabKey, string | null> = {
    outline: plan ? String(plan.skeleton.nodes.length) : null,
    glossary: plan ? String(glossaryCount) : null,
    lessons: plan ? String(lessons.length) : null,
    params: null,
    trace: events.length > 0 ? String(events.length) : null,
  }

  return (
    <div className="ws" aria-label="方案工作区">
      <div className="ws-head">
        <div className="ws-title">
          方案工作区
          <span className={`tag ${tag.cls}`}>{tag.text}</span>
          <span className="grow" />
          {plan ? (
            <span className="ws-meta">
              v{plan.version} · {plan.skeleton.nodes.length} 章 · {lessons.length} 节
            </span>
          ) : null}
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
          {running ? (
            <NextActionBanner tone="info">
              Agent 正在起草方案{matText ? `（${matText}）` : ''}…草案四件套产出后自动呈现，
              进度见中栏对话流。
            </NextActionBanner>
          ) : null}
          {failure ? (
            <NextActionBanner
              tone="warn"
              action={{ label: failure.action?.label ?? '去修改重提', onClick: () => setTab('params') }}
            >
              {failure.text}
            </NextActionBanner>
          ) : null}
          {review && review.status === 'manual' ? (
            <NextActionBanner tone="warn" action={{ label: '去修改重提', onClick: () => setTab('params') }}>
              规划自检连续 {review.attempts} 次未通过，方案没有呈现给你——修掉下面的问题后可重新提交。
            </NextActionBanner>
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
            <NextActionBanner tone="warn">
              {lowMatchCount} 章证据不足、{violationCount} 条拒绝记录——在大纲里改名或删掉这些章节后才能批准。
            </NextActionBanner>
          ) : null}
          {plan && !approved && !blocked ? (
            <NextActionBanner tone="ok" action={{ label: '去对话批准', onClick: onGoChat }}>
              方案四件套齐全（v{plan.version}），批准卡已发到对话流，点选即可锁定基准版。
            </NextActionBanner>
          ) : null}
          {!plan && !running && !jobFailed ? (
            <NextActionBanner tone="info" action={{ label: '去提交目标与目录', onClick: () => setTab('params') }}>
              第 1 步：提交课程目标（人工目录可留空，由 Agent 代拟）——Agent 依据目标与已就绪素材起草方案。
            </NextActionBanner>
          ) : null}

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
          ) : (
            <p className="note">还没有方案——在「参数」页签提交课程目标与目录后，Agent 开始起草。</p>
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
            <p className="note">概念图与术语表随方案起草生成。</p>
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
            <p className="note">分节计划随方案起草生成。</p>
          )}
          {plan?.coverage ? <CoverageNote coverage={plan.coverage} /> : null}        </div>

        <div className={`ctpane${tab === 'params' ? ' on' : ''}`}>
          <PlanDraftForm
            courseId={courseId}
            initial={input}
            materials={materials}
            courseMaterials={courseMaterials}
            onSubmitted={onRefresh}
          />
          {plan ? (
            <p className="note">
              提交新目标会触发重新起草（当前草案被打回）；只想小改请直接在大纲页签微调，或在中栏告诉 Agent。
            </p>
          ) : null}
        </div>

        <div className={`ctpane${tab === 'trace' ? ' on' : ''}`}>
          {events.length === 0 ? (
            <p className="note">系统事件（起草完成 / 失败 / 批准结果）会按时间列在这里。</p>
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
