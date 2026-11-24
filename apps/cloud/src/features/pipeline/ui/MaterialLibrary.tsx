'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaAssetView } from '@trend-suite/contracts'
import { useCourses } from '@/features/content/ui/CoursesProvider'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '../api'
import { MaterialCard } from './MaterialCard'
import { MaterialUploader } from './MaterialUploader'
import { readinessOf } from './processing'

/**
 * 素材库（教师端需求 T4）：所有课程的视频收在一处。
 *
 * 这里是「全局视角」——教师名下所有课程的素材都能看到，
 * 每份素材标出归属课程；素材上传与转写只收口在这里。
 */
export function MaterialLibrary() {
  const { courses } = useCourses()
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [courseFilter, setCourseFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets())
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : '素材列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 有素材在跑就轮询：三段状态会自己往前推。 */
  const busy = assets.some((asset) => {
    const readiness = readinessOf(asset)
    return readiness === 'running' || readiness === 'queued'
  })

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => void refresh(), 3_000)
    return () => clearInterval(timer)
  }, [busy, refresh])

  const onChanged = useCallback((next: MediaAssetView) => {
    setAssets((prev) => prev.map((asset) => (asset.id === next.id ? next : asset)))
  }, [])

  const onRemoved = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((asset) => asset.id !== assetId))
  }, [])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return assets.filter((asset) => {
      if (courseFilter !== 'all' && asset.courseId !== courseFilter) return false
      if (keyword && !asset.fileName.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [assets, courseFilter, query])

  const stats = useMemo(() => {
    let ready = 0
    let running = 0
    let failed = 0
    for (const asset of assets) {
      const readiness = readinessOf(asset)
      if (readiness === 'ready') ready += 1
      else if (readiness === 'failed') failed += 1
      else running += 1
    }
    return { ready, running, failed }
  }, [assets])

  return (
    <section>
      <div className="ops-ph">
        <div>
          <div className="t">素材库</div>
          <div className="s">
            所有课程的视频都收在这里。每一份素材都拆成三段可单独重跑的分析：逐字稿 · 关键帧 · 视频理解。
          </div>
        </div>
      </div>

      {listError ? <div className="notice err">{listError}</div> : null}
      {actionError ? <div className="notice err">{actionError}</div> : null}

      <MaterialUploader
        courses={courses.map((course) => ({ id: course.id, title: course.title }))}
        onDone={refresh}
      />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div>
          <h2>
            素材 · {assets.length}
            <span className="meta" style={{ marginLeft: 10 }}>
              就绪 {stats.ready} · 处理中 {stats.running} · 失败 {stats.failed}
            </span>
          </h2>
          <p className="sub">每一份素材的三段分析各自可看、可重跑、可单独删除。</p>
        </div>
        <div className="actions">
          <input
            className="input"
            placeholder="搜索文件名"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="ops-tabs">
        <button
          type="button"
          className={`ops-tab ${courseFilter === 'all' ? 'on' : ''}`}
          onClick={() => setCourseFilter('all')}
        >
          全部课程
        </button>
        {courses.map((course) => (
          <button
            type="button"
            className={`ops-tab ${courseFilter === course.id ? 'on' : ''}`}
            key={course.id}
            onClick={() => setCourseFilter(course.id)}
          >
            {course.title}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">素材加载中…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {assets.length === 0
            ? '还没有素材。把课程录像拖到上面的上传区试试。'
            : '没有匹配的素材。换个课程或清空搜索词看看。'}
        </div>
      ) : (
        <div className="matcards">
          {visible.map((asset) => (
            <MaterialCard
              key={asset.id}
              asset={asset}
              showCourse
              onChanged={onChanged}
              onRemoved={onRemoved}
              onError={setActionError}
            />
          ))}
        </div>
      )}
    </section>
  )
}
