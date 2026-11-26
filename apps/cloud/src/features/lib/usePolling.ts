'use client'

import { useEffect, useRef } from 'react'

/**
 * 统一轮询（评审改进）：tab 切后台（document.hidden）时暂停，回到前台
 * 立即刷一次再恢复节奏——后台标签不再空耗接口（此前 MaterialLibrary /
 * PlanPanel / ProductionStudio 各自 setInterval 3s，切后台照样打）。
 *
 * fn 必须幂等（轮询语义）；interval 变化会重启计时器。
 */
export function usePolling(fn: () => void | Promise<unknown>, intervalMs: number): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => void fnRef.current(), intervalMs)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        void fnRef.current() // 回前台立即对齐一次，再恢复节奏
        start()
      }
    }
    if (document.hidden) {
      document.addEventListener('visibilitychange', onVisibility)
      return stop
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])
}
