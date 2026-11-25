'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AgentMessageView, MediaAssetView, PlanResponse, TweakPlanRequest } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getPlan, tweakPlan } from '../api'
import { AgentChat } from '@/features/agent-chat/AgentChat'
import { useAgentStream } from '@/features/agent-chat/useAgentStream'
import { usePanelWidth } from '@/features/shell/PanelDivider'
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
  const ws = usePanelWidth('wb.ws.w.plan')
  const stream = useAgentStream(courseId, 'plan')

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
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [running, refresh])

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

  const events: AgentMessageView[] = stream.messages.filter(
    (message) => message.role === 'event' || message.role === 'todo',
  )

  // 首次打开课程（还没有方案、没有任务在途）：对话区空态给「选择素材」入口。
  const jobFailed = !plan && job?.status === 'failed'
  const fresh = !plan && !running && !jobFailed

  function confirmAssets(assets: MediaAssetView[]) {
    const list = assets.map((asset) => `${asset.fileName}（id：${asset.id}）`).join('、')
    void stream.send(`已从素材库选择 ${assets.length} 份素材开始制作：${list}。请用这些素材起草课程方案。`)
  }

  if (loading) {
    return <div className="empty">方案加载中…</div>
  }

  // 快捷指令一点即发（主流 AskQuestion 口径）：未起草课一键进入起草对话。
  const chips = running
    ? []
    : plan
      ? ['重新梳理大纲', '合并相近章节', '调整分节粒度', '解释这一版']
      : ['开始起草方案']

  return (
    <div className="plan-split" style={ws.style}>
      <AgentChat
        id="agent-chat"
        stream={stream}
        crumb={`${courseTitle ?? '课程'} / 制作方案${plan ? ` v${plan.version}` : ''}`}
        subtitle="方案阶段 · 起草 / 打磨 / 批准"
        userName={userName}
        draftingLabel={running ? `正在起草方案（第 ${job?.attempts ?? 1} 次尝试）…` : null}
        emptyHint="还没有对话——把课程目标发给 Agent（目录可一并粘贴，或让 Agent 代拟），它会用确认卡和你对齐规划方式后开始起草。"
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
      <AssetPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={confirmAssets}
      />
      <div className="wb-col" ref={ws.railRef}>
        <div {...ws.handleProps} />
        <PlanWorkspace
          courseId={courseId}
          plan={plan}
          job={job}
          materials={materials}
          review={data?.review ?? null}
          busy={busy}
          error={error}
          notice={notice}
          events={events}
          onTweak={tweak}
        />
      </div>
    </div>
  )
}
