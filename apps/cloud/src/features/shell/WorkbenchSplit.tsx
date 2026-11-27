'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { NARROW_QUERY } from '@/lib/breakpoints'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import styles from './WorkbenchSplit.module.css'

/**
 * 工作台双栏分隔（arch/08 §6）：中栏对话 + 右栏产物工作区。
 * shadcn Resizable（react-resizable-panels v2）承载拖拽与键盘（方向键微调、
 * Home/End 首尾、双击复位）；autoSaveId 内置布局持久化（沿用 wb.ws.w.* 键域）。
 * 右栏可收起（Sasan 的「收起/展开课程资源」同款）：收起后只剩一个展开钮。
 * 窄屏（<1280px）回退单栏堆叠。右栏限幅 340–680px 的百分比近似：rail 28–55%。
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const apply = () => setNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return narrow
}

export function WorkbenchSplit({
  storageKey,
  main,
  rail,
}: {
  /** autoSaveId：布局持久化键（wb.ws.w.* 命名域）。 */
  storageKey: string
  /** 中栏（Agent 对话流）。 */
  main: ReactNode
  /** 右栏（产物工作区）。 */
  rail: ReactNode
}) {
  const narrow = useNarrowViewport()
  const [collapsed, setCollapsed] = useState(false)

  if (narrow) {
    return (
      <div className="plan-split plan-split--narrow">
        <div className="wb-col">{main}</div>
        <div className="wb-col">{rail}</div>
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className={`plan-split ${styles.collapsed}`}>
        <div className="wb-col">{main}</div>
        <button
          type="button"
          className={styles.expand}
          onClick={() => setCollapsed(false)}
          aria-label="展开工作区"
          title="展开工作区"
        >
          <PanelRightOpen className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId={storageKey} className="plan-split">
      <ResizablePanel defaultSize={58} minSize={45} className="wb-col">
        {main}
      </ResizablePanel>
      <ResizableHandle>
        <button
          type="button"
          className={styles.collapse}
          onClick={() => setCollapsed(true)}
          aria-label="收起工作区"
          title="收起工作区"
        >
          <PanelRightClose className="size-3.5" />
        </button>
      </ResizableHandle>
      <ResizablePanel defaultSize={42} minSize={28} maxSize={55} className="wb-col">
        {rail}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
