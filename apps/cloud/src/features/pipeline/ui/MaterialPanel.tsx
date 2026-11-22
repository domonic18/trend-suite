'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '../api'
import { MaterialCard } from './MaterialCard'
import { MaterialUploader } from './MaterialUploader'
import { readinessOf } from './processing'

/**
 * 课程内素材视图：只看这门课的素材。
 *
 * 素材卡与素材库共用一套（MaterialCard）——三段格、重跑、删除的口径只有一份。
 */
export function MaterialPanel({ courseId }: { courseId: string }) {
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setAssets(await listAssets(courseId))
      setListError(null)
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : '素材列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 有素材在跑就轮询：转写中的段落边转边读。 */
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

  return (
    <section>
      {listError ? <div className="notice err">{listError}</div> : null}
      {actionError ? <div className="notice err">{actionError}</div> : null}

      <MaterialUploader fixedCourseId={courseId} onDone={refresh} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div>
          <h2>素材 · {assets.length}</h2>
          <p className="sub">
            上传完成的录像会在这里自动转写、抽取关键帧并做视频理解；三段各自可重跑、可单独删除。
          </p>
        </div>
      </div>

      {loading ? (
        <div className="empty">素材加载中…</div>
      ) : assets.length === 0 ? (
        <div className="empty">还没有素材。拖一段课程录像进来试试。</div>
      ) : (
        <div className="matcards">
          {assets.map((asset) => (
            <MaterialCard
              key={asset.id}
              asset={asset}
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
