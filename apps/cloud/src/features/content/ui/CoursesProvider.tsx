'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { CourseSummaryView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listCourses } from '../api'

/**
 * 课程列表：侧栏、阶段轨与课程卡共用一份。
 *
 * 放在 (console)/workbench 的 layout 里，路由切换不卸载 →
 * 切课、切阶段不再重新拉列表。
 */

type CoursesState = {
  courses: CourseSummaryView[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const CoursesContext = createContext<CoursesState | null>(null)

export function CoursesProvider({ children }: { children: ReactNode }) {
  const [courses, setCourses] = useState<CourseSummaryView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setCourses(await listCourses())
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '课程列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<CoursesState>(
    () => ({ courses, loading, error, refresh }),
    [courses, loading, error, refresh],
  )

  return <CoursesContext.Provider value={value}>{children}</CoursesContext.Provider>
}

export function useCourses(): CoursesState {
  const value = useContext(CoursesContext)
  if (!value) throw new Error('useCourses 必须在 CoursesProvider 内使用')
  return value
}
