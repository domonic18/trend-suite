'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { useState } from 'react'
import type { PlanJobView, PlanReviewView, PlanView, TweakPlanRequest } from '@trend-suite/contracts'
import { classifyDraftFailure } from './draftFailure'
import { WORKSPACE_TABS, EmptyPanel, type WorkspaceTabKey } from '@/features/courseware/ui/workspaceTabs'
import { OutlineSkeleton } from './OutlineSkeleton'
import { OutlineTree } from './OutlineTree'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * 方案页右栏课件工作区（arch/08 §6）：页签统一为**课件元素类别**（大纲 /
 * 课件 / 配图 / 视频 / K线图 / 练习题 / 互动，与制作台同构）——教师从方案
 * 阶段看到的就是最终课件的元素维度；方案阶段只有大纲（骨架树），其余元素
 * 批准制作后逐节生成。微调即时生效、不进对话；不放横幅与动作按钮。
 */



/** 课件元素在方案阶段的空态（最小状态句，无教学标注）。 */

export function PlanWorkspace({
  plan,
  job,
  review,
  busy,
  error,
  notice,
  onTweak,
  onApprove,
  approving = false,
  approveError = null,
}: {
  plan: PlanView | null
  job: PlanJobView | null
  review: PlanReviewView | null
  busy: boolean
  error: string | null
  notice: string | null
  onTweak: (op: TweakPlanRequest) => void
  /** 确认大纲并开始制作（确定性批准端点，不经 LLM）。 */
  onApprove?: (() => void) | undefined
  approving?: boolean
  approveError?: string | null
}) {
  const [tab, setTab] = useState<WorkspaceTabKey>('outline')

  const running = job?.status === 'queued' || job?.status === 'running'
  const approved = plan?.status === 'approved'
  const jobFailed = !plan && job?.status === 'failed'
  const failure = jobFailed ? classifyDraftFailure(job) : null

  const counts: Record<WorkspaceTabKey, string | null> = {
    outline: plan ? String(plan.skeleton.nodes.length) : null,
    artifact: null,
    figures: null,
    video: null,
    kline: null,
    quiz: null,
    interactive: null,
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as WorkspaceTabKey)}
      className="ws"
      aria-label="课件工作区"
    >
      <div className="ws-head">
        <div className="ws-title">
          课件工作区
          {plan && !approved && onApprove ? (
            <Button
              size="sm"
              className="ml-auto"
              disabled={approving}
              onClick={onApprove}
            >
              {approving ? '正在解锁制作…' : '确认大纲，开始制作'}
            </Button>
          ) : null}
        </div>
        {approveError ? (
          <Alert variant="destructive" className="mx-2 mt-2">
            <AlertDescription>{approveError}</AlertDescription>
          </Alert>
        ) : null}
        <TabsList className="h-auto justify-start gap-0.5 overflow-x-auto rounded-none border-b border-line bg-transparent p-0.5">
          {WORKSPACE_TABS.map((item) => (
            <TabsTrigger
              key={item.key}
              value={item.key}
              className="rounded-none border-b-2 border-transparent px-3 py-2 text-[12.5px] text-mut data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:shadow-none"
            >
              <item.icon className="size-3.5" aria-hidden="true" />
              {item.label}
              {counts[item.key] ? <span className="n">{counts[item.key]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="ws-body">
        <TabsContent value="outline" className="mt-0">
          {error ? <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{error}</AlertDescription>
    </Alert> : null}
          {notice ? <Alert className="mb-3.5 border-transparent bg-warn-soft text-warn">
      <AlertDescription>{notice}</AlertDescription>
    </Alert> : null}

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
                          {violation.resolved ? <Badge className="tag ok">已自动处理</Badge> : null}
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
          ) : running ? (
            <OutlineSkeleton />
          ) : failure ? (
            <p className="note">{failure.text}</p>
          ) : (
            <p className="note">还没有方案。</p>
          )}
        </TabsContent>

        {WORKSPACE_TABS.filter((item) => item.key !== 'outline').map((item) => (
          <TabsContent value={item.key} key={item.key} className="mt-0">
            <EmptyPanel tabKey={item.key} />
          </TabsContent>
        ))}
      </div>
    </Tabs>
  )
}
