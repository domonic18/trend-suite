'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MediaAssetView, PlanResponse, TweakPlanRequest } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { usePolling } from '@/features/lib/usePolling'
import { approvePlan, getPlan, tweakPlan } from '../api'
import { AgentChat } from '@/features/agent-chat/AgentChat'
import { useAgentStream } from '@/features/agent-chat/useAgentStream'
import { WorkbenchSplit } from '@/features/shell/WorkbenchSplit'
import { CourseWorkspaceSkeleton } from './OutlineSkeleton'
import { useCourses } from './CoursesProvider'
import { takeDraftNotice } from './draftNotice'
import { AssetPickerDialog } from './AssetPickerDialog'
import { PlanWorkspace } from './PlanWorkspace'

export type MaterialsReady = { ready: number; total: number }

/**
 * 方案页（迭代 11，arch/08 chat-center）：中栏 = 与 Agent 的真多轮对话，
 * 交互只有三种——自由文本（composer，目标与目录在这里给）、AskQuestion
 * 确认卡（规划方式等选择，点选即答、可附言）、快捷指令（一点即发）；首次打开
 * 课程（还没有方案）时空态另有「选择素材，开始制作」入口——弹窗多选素材库
 * 视频，确认即发一条带素材 id 的对话消息，Agent 依此触发起草。右栏 = 纯产物
 * 工作区（大纲/术语/分节/轨迹，微调即时生效、不进对话）。批准由服务端在方案
 * 就绪时发确认卡，教师点选后确定性执行；右栏宽度可拖拽/键盘调整并持久化，
 * 对话事件驱动右栏重取（refreshKey），轮询仅作兜底。
 */
export function PlanPanel({
  courseId,
  materials = null,
  userName = '教师',
  courseTitle,
}: {
  courseId: string
  materials?: MaterialsReady | null
  userName?: string
  courseTitle?: string | null
}) {
  const [data, setData] = useState<PlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const stream = useAgentStream(courseId, 'plan')
  const { refresh: refreshCourses } = useCourses()

  /** 确认大纲：批准（确定性端点）→ 原地切换制作形态（课程工作台按
   * planStatus 重渲；生产由服务端自动排队开跑，不换页不二次加载）。 */
  const confirmAndProduce = useCallback(async () => {
    setApproving(true)
    setApproveError(null)
    try {
      await approvePlan(courseId)
      await refreshCourses()
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : '批准失败，请稍后再试')
      setApproving(false)
    }
  }, [courseId, refreshCourses])

  // 建课后触发起草失败的原因：课程已建好，提示带到这一页，别让教师再建一门课。
  useEffect(() => {
    setNotice(takeDraftNotice())
  }, [])

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
  usePolling(refresh, running ? 3_000 : 60_000) // 起草中 3s；空闲降到 60s 兜底

  // 对话事件驱动右栏重取（refreshKey = 最新消息 seq）：起草完成等事实落流即刷新。
  const lastSeq = stream.lastSeq
  useEffect(() => {
    if (lastSeq > 0) void refresh()
  }, [lastSeq, refresh])

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

  function tweak(op: TweakPlanRequest) {
    void act(() => tweakPlan(courseId, op))
  }

  // 首次打开课程（还没有方案、没有任务在途）：对话区空态给「选择素材」入口。
  const jobFailed = !plan && job?.status === 'failed'
  const fresh = !plan && !running && !jobFailed

  function confirmAssets(assets: MediaAssetView[]) {
    const list = assets.map((asset) => `${asset.fileName}（id：${asset.id}）`).join('、')
    void stream.send(`已从素材库选择 ${assets.length} 份素材开始制作：${list}。请用这些素材起草课程方案。`)
  }

  if (loading) {
    return <CourseWorkspaceSkeleton />
  }

  // 快捷指令一点即发（主流 AskQuestion 口径）：未起草课一键进入起草对话。
  const chips = running
    ? []
    : plan
      ? ['重新梳理大纲', '合并相近章节', '调整分节粒度', '解释这一版']
      : ['开始起草方案']

  return (
    <>
      <AssetPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={confirmAssets}
      />
      <WorkbenchSplit
        storageKey="wb.ws.w.plan"
        main={
          <AgentChat
            stream={stream}
            crumb={`${courseTitle ?? '课程'} / 制作方案${plan ? ` v${plan.version}` : ''}`}
            userName={userName}
            draftingLabel={running ? `正在起草方案（第 ${job?.attempts ?? 1} 次尝试）…` : null}
            emptyHint="还没有对话——把课程主题发给 Agent，它会起草大纲并和你对齐。"
            emptyAction={
              fresh
                ? {
                    label: '选择素材，开始制作',
                    description: '从素材库勾选课程视频（可跨课、可多选），确认后自动起草方案',
                    onClick: () => setPickerOpen(true),
                  }
                : null
            }
            quickChips={chips}
          />
        }
        rail={
          <PlanWorkspace
            plan={plan}
            job={job}
            review={data?.review ?? null}
            busy={busy}
            error={error}
            notice={notice}
            onTweak={tweak}
            onApprove={() => void confirmAndProduce()}
            approving={approving}
            approveError={approveError}
          />
        }
      />
    </>
  )
}
