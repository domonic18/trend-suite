'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '../api'
import { MaterialCard } from './MaterialCard'
import { MaterialUploader } from './MaterialUploader'
import { readinessOf } from './processing'

/**
 * 素材库（教师端需求 T4）：视频素材独立上传、收在一处。
 * 不耦合课程——上传不选课、列表不按课程分页；素材与课程的关联在建课勾选时建立。
 */
export function MaterialLibrary() {
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
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
    if (!keyword) return assets
    return assets.filter((asset) => asset.fileName.toLowerCase().includes(keyword))
  }, [assets, query])

  return (
    <section>
      <div className="ops-ph">
        <div>
          <div className="t">素材库</div>
        </div>
      </div>

      {listError ? <div className="notice err">{listError}</div> : null}
      {actionError ? <div className="notice err">{actionError}</div> : null}

      <MaterialUploader onDone={refresh} />

      <div className="page-head" style={{ marginTop: 26 }}>
        <div className="actions">
          <input
            className="input"
            placeholder="搜索文件名"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="empty">素材加载中…</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {assets.length === 0
            ? '还没有素材。'
            : '没有匹配的素材。'}
        </div>
      ) : (
        <div className="matcards">
          {visible.map((asset) => (
            <MaterialCard key={asset.id} asset={asset} onChanged={onChanged} onRemoved={onRemoved} onError={setActionError} />
          ))}
        </div>
      )}
    </section>
  )
}
