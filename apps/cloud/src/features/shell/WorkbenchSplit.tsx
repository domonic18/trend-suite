'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'

/**
 * 工作台双栏分隔（arch/08 §6）：中栏对话 + 右栏产物工作区。
 * shadcn Resizable（react-resizable-panels v4）承载拖拽与键盘（方向键微调、
 * Home/End 首尾、双击复位）；v4 无 autoSaveId，布局数组经 onLayoutChange
 * 持久化（沿用 wb.ws.w.* 键域，存百分比数组）。窄屏（<1280px）回退单栏堆叠。
 *
 * 右栏限幅 340–680px：面板按百分比布局，像素限幅由 Panel 内层 min/max-width
 * 约束（拖到边界时内容不再收窄）。
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1280px)')
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return narrow
}

const DEFAULT_LAYOUT: Record<string, number> = { main: 58, rail: 42 }

export function WorkbenchSplit({
  storageKey,
  main,
  rail,
}: {
  /** 布局持久化键（wb.ws.w.* 命名域，存 { main, rail } 百分比 JSON）。 */
  storageKey: string
  /** 中栏（Agent 对话流）。 */
  main: ReactNode
  /** 右栏（产物工作区）。 */
  rail: ReactNode
}) {
  const narrow = useNarrowViewport()
  const [layout, setLayout] = useState<Record<string, number>>(DEFAULT_LAYOUT)

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null')
      if (
        saved &&
        typeof saved.main === 'number' &&
        typeof saved.rail === 'number'
      ) {
        setLayout(saved)
      }
    } catch {
      // 忽略损坏的持久化值，用默认布局
    }
  }, [storageKey])

  const onLayoutChange = useCallback(
    (next: Record<string, number>) => {
      setLayout(next)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        // 隐私模式等场景写不进就算了
      }
    },
    [storageKey],
  )

  if (narrow) {
    return (
      <div className="plan-split plan-split--narrow">
        <div className="wb-col">{main}</div>
        <div className="wb-col">{rail}</div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="plan-split"
      defaultLayout={layout}
      onLayoutChange={onLayoutChange}
    >
      <ResizablePanel id="main" className="wb-col" minSize={45}>
        {main}
      </ResizablePanel>
      <ResizableHandle className="ws-resizer" />
      <ResizablePanel id="rail" className="wb-col wb-col--rail" minSize={28} maxSize={55}>
        {rail}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
