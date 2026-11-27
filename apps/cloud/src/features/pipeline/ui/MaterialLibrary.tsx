'use client'

import { Input } from '@/components/ui/input'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { usePolling } from '@/features/lib/usePolling'
import { POLL_MS } from '@/lib/polling'
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

  usePolling(refresh, busy ? POLL_MS.active : POLL_MS.idle)

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

      {listError ? <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{listError}</AlertDescription>
    </Alert> : null}
      {actionError ? <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{actionError}</AlertDescription>
    </Alert> : null}

      <MaterialUploader onDone={refresh} />

      <div className="page-head page-head--top">
        <div className="actions">
          <Input
            placeholder="搜索文件名"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-[280px]"
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
