'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AgentMessageView, PlanResponse, TweakPlanRequest } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getPlan, tweakPlan } from '../api'
import { AgentChat } from '@/features/agent-chat/AgentChat'
import { useAgentStream } from '@/features/agent-chat/useAgentStream'
import { useWsDrag } from '@/features/agent-chat/useWsDrag'
import { takeDraftNotice } from './draftNotice'
import { PlanWorkspace } from './PlanWorkspace'

export type MaterialsReady = { ready: number; total: number }

/**
 * 方案页（迭代 11，arch/08 chat-center）：中栏 = 与 Agent 的真多轮对话
 * （起草 / 打磨 / 批准确认卡），右栏 = 产物工作区（大纲/术语/分节/参数/轨迹，
 * 微调即时生效、不进对话）。批准与打回不再有独立表单——批准由服务端在方案
 * 就绪时发确认卡，教师点选后确定性执行；右栏 340–680px 可拖拽。
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
  const ws = useWsDrag()
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

  function goChat() {
    document.getElementById('agent-chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const events: AgentMessageView[] = stream.messages.filter(
    (message) => message.role === 'event' || message.role === 'todo',
  )

  if (loading) {
    return <div className="empty">方案加载中…</div>
  }

  return (
    <div
      className="plan-split"
      {...(ws.width != null ? { style: { '--ws-w': `${ws.width}px` } as CSSProperties } : {})}
    >
      <AgentChat
        id="agent-chat"
        stream={stream}
        crumb={`${courseTitle ?? '课程'} / 制作方案${plan ? ` v${plan.version}` : ''}`}
        subtitle="方案阶段 · 起草 / 打磨 / 批准"
        userName={userName}
        draftingLabel={running ? `正在起草方案（第 ${job?.attempts ?? 1} 次尝试）…` : null}
        emptyHint="还没有对话——提交课程目标与目录后，Agent 会在对话里推进起草与打磨（表单在右栏「参数」页签）。"
        quickChips={['重新梳理大纲', '合并相近章节', '调整分节粒度', '解释这一版']}
      />
      <div className="wb-col" ref={ws.ref}>
        <div className="ws-drag" onPointerDown={ws.onPointerDown} aria-hidden="true" />
        <PlanWorkspace
          courseId={courseId}
          courseTitle={courseTitle ?? null}
          plan={plan}
          job={job}
          input={data?.input ?? null}
          courseMaterials={data?.materials ?? []}
          materials={materials}
          review={data?.review ?? null}
          busy={busy}
          error={error}
          notice={notice}
          events={events}
          onTweak={tweak}
          onRefresh={() => void refresh()}
          onGoChat={goChat}
        />
      </div>
    </div>
  )
}
