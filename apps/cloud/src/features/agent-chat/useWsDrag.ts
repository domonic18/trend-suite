'use client'

import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

/**
 * 右栏工作区拖拽宽度（340–680px，写入 --ws-w CSS 变量）。
 * 方案页与制作台共用同一套 chat-center 布局与拖拽手感。
 */
export function useWsDrag(min = 340, max = 680): {
  ref: RefObject<HTMLDivElement | null>
  width: number | null
  onPointerDown: (event: ReactPointerEvent) => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  function onPointerDown(event: ReactPointerEvent) {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      const rect = ref.current?.getBoundingClientRect()
      if (!rect) return
      setWidth(Math.round(Math.min(max, Math.max(min, rect.right - moveEvent.clientX))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { ref, width, onPointerDown }
}
