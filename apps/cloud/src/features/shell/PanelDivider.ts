'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'

/**
 * 右栏面板分隔（arch/08 §6，对齐 SasanImmersive PanelDivider）：拖拽调整宽度
 * （340–680px 写 --ws-w CSS 变量），键盘方向键微调（Shift 放大步长）、Home/End
 * 到边界、双击复位；宽度按 storageKey 持久化到 localStorage。
 * handleProps 铺在分隔条上（role=separator 可聚焦可读值），railRef 挂右栏容器。
 */
export function usePanelWidth(
  storageKey: string,
  defaultWidth = 520,
  min = 340,
  max = 680,
): {
  railRef: RefObject<HTMLDivElement | null>
  width: number
  style: CSSProperties
  handleProps: {
    className: string
    role: 'separator'
    tabIndex: number
    'aria-orientation': 'vertical'
    'aria-valuemin': number
    'aria-valuemax': number
    'aria-valuenow': number
    'aria-label': string
    onPointerDown: (event: ReactPointerEvent) => void
    onKeyDown: (event: ReactKeyboardEvent) => void
    onDoubleClick: () => void
  }
} {
  const railRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState<number>(defaultWidth)

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(storageKey))
    if (Number.isFinite(saved) && saved >= min && saved <= max) setWidth(saved)
  }, [storageKey, min, max])

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(max, Math.max(min, next)))
      setWidth(clamped)
      window.localStorage.setItem(storageKey, String(clamped))
    },
    [storageKey, min, max],
  )

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault()
      const move = (moveEvent: PointerEvent) => {
        const rect = railRef.current?.getBoundingClientRect()
        if (!rect) return
        apply(rect.right - moveEvent.clientX)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [apply],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const step = event.shiftKey ? 48 : 16
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        apply(width + step)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        apply(width - step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        apply(max)
      } else if (event.key === 'End') {
        event.preventDefault()
        apply(min)
      }
    },
    [apply, width, min, max],
  )

  return {
    railRef,
    width,
    style: { '--ws-w': `${width}px` } as CSSProperties,
    handleProps: {
      className: 'ws-drag',
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-valuenow': width,
      'aria-label': '调整工作区宽度（方向键微调，双击复位）',
      onPointerDown,
      onKeyDown,
      onDoubleClick: () => apply(defaultWidth),
    },
  }
}
