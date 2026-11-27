'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProductionBoardView,
  SectionContentView,
  SectionQuotesView,
} from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { usePolling } from '@/features/lib/usePolling'
import { POLL_MS } from '@/lib/polling'
import { listAssets } from '@/features/pipeline/api'
import { AgentChat } from '@/features/agent-chat/AgentChat'
import { useAgentStream } from '@/features/agent-chat/useAgentStream'
import { WorkbenchSplit } from '@/features/shell/WorkbenchSplit'
import { getProductionBoard, resyncSectionQuotes, retryProductionSection } from '../api'
import { getSectionContent, getSectionQuotes } from '@/features/courseware/api'
import { ProductionWorkspace } from './ProductionWorkspace'

/**
 * 课件制作台（arch/08 chat-center，教师端需求 T21）：与方案页同一形态——
 * 中栏 = 制作 Agent 的真多轮对话（九步事实与逐节 TODO 卡由 worker 写进对话流，
 * 停止/继续/重试是对话动作）；右栏 = 制作工作区（页签：大纲 / 课件 / 配图 /
 * 视频 / K线图 / 练习题 / 互动），宽度可拖拽并持久化。
 *
 * 本组件只做「取数 + 对话流」；右栏呈现与页签在 ProductionWorkspace。
 * 停止制作是**步边界**安全中止：成果保留、回灌预算保留、改完可继续。
 */

export function ProductionStudio({
  courseId,
  userName = '教师',
}: {
  courseId: string
  userName?: string
}) {
  const [board, setBoard] = useState<ProductionBoardView | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [content, setContent] = useState<SectionContentView | null>(null)
  const [quotes, setQuotes] = useState<SectionQuotesView | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [assetNames, setAssetNames] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stream = useAgentStream(courseId, 'production')

  const refreshBoard = useCallback(async () => {
    try {
      setBoard(await getProductionBoard(courseId))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '制作台加载失败')
    }
  }, [courseId])

  useEffect(() => {
    void refreshBoard()
  }, [refreshBoard])

  useEffect(() => {
    void listAssets(courseId)
      .then((assets) => setAssetNames(new Map(assets.map((asset) => [asset.id, asset.fileName]))))
      .catch(() => undefined)
  }, [courseId])

  const job = board?.job ?? null
  const sections = board?.sections ?? []
  const running =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    sections.some((section) => section.tasks.some((task) => task.status === 'running'))
  /** 停止请求下达后到 worker 走到步边界之间，job 仍是 running——那段时间按「已停止」呈现。 */
  const stopped = board?.stop != null
  const inFlight = running && !stopped

  usePolling(refreshBoard, POLL_MS.active)

  /** 当前展示的节：默认跟随正在跑的那节，教师点选后钉住。 */
  const currentId = useMemo(() => {
    const runningSection = sections.find((section) =>
      section.tasks.some((task) => task.status === 'running'),
    )
    return (
      pinned ??
      runningSection?.sectionId ??
      sections.find((section) => section.status !== 'complete')?.sectionId ??
      sections[0]?.sectionId ??
      null
    )
  }, [sections, pinned])
  const current = useMemo(
    () => sections.find((section) => section.sectionId === currentId) ?? null,
    [sections, currentId],
  )

  // 正文随生产实时刷新：节产物数或正文状态一变就重取。
  const contentSig = current ? `${current.sectionId}:${current.products}:${current.bodyStatus}` : ''
  useEffect(() => {
    if (!currentId) {
      setContent(null)
      return
    }
    let stale = false
    void getSectionContent(courseId, currentId)
      .then((value) => {
        if (!stale) setContent(value)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [courseId, currentId, contentSig])

  const retry = useCallback(
    async (sectionId: string) => {
      setBusy(true)
      try {
        await retryProductionSection(courseId, sectionId)
        await refreshBoard()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '重试失败，请稍后再试')
      } finally {
        setBusy(false)
      }
    },
    [courseId, refreshBoard],
  )

  // 行情随节切换重取：K线页签直接画案例股的 K 线（不等课件步产出）。
  useEffect(() => {
    if (!currentId) {
      setQuotes(null)
      return
    }
    let stale = false
    void getSectionQuotes(courseId, currentId)
      .then((value) => {
        if (!stale) setQuotes(value)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [courseId, currentId])

  /** 同步行情：重置该节行情步重投，然后轮询补数（bars 到齐或 60 秒超时即停）。 */
  const syncQuotes = useCallback(async () => {
    if (!currentId || syncing) return
    setSyncing(true)
    setError(null)
    try {
      await resyncSectionQuotes(courseId, currentId)
      const deadline = Date.now() + 60_000
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 5_000))
        const value = await getSectionQuotes(courseId, currentId)
        setQuotes(value)
        if (value.stocks.length > 0 && value.stocks.every((stock) => stock.bars.length > 0)) break
        if (Date.now() >= deadline) break
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '同步行情失败，请稍后再试')
    } finally {
      setSyncing(false)
    }
  }, [courseId, currentId, syncing])

  const doneSteps = sections.reduce((sum, section) => sum + section.products, 0)
  const totalSteps = sections.length * 9
  const boardReady = board != null && sections.length > 0

  return (
    <WorkbenchSplit
      storageKey="wb.ws.w.production"
      main={
        <AgentChat
        stream={stream}
        userName={userName}
        draftingLabel={inFlight ? `正在逐节制作（已完成 ${doneSteps}/${totalSteps} 步）…` : null}
        emptyHint="还没有对话——九步生产的每一步事实会自动留在这里；也可以直接吩咐 Agent 停止、继续或重试。"
          quickChips={boardReady ? ['看看现在做到哪了', '停止制作', '继续制作', '重试挂起的节'] : []}
        />
      }
      rail={
        <ProductionWorkspace
          board={board}
          courseId={courseId}
          current={current}
          currentId={currentId}
          content={content}
          quotes={quotes}
          assetNames={assetNames}
          error={error}
          busy={busy}
          syncing={syncing}
          onSelectSection={setPinned}
          onRetry={(sectionId) => void retry(sectionId)}
          onSyncQuotes={() => void syncQuotes()}
        />
      }
    />
  )
}
