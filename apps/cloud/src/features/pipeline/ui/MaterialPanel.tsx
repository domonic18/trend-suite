'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_MEDIA_BYTES, type MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { createAsset, listAssets, uploadToTarget } from '../api'

type Uploading = { name: string; loaded: number; total: number }

const STATUS_TEXT: Record<MediaAssetView['status'], string> = {
  awaiting_upload: '等待上传',
  uploaded: '已上传',
  processing: '加工中',
  ready: '就绪',
  failed: '失败',
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function MaterialPanel({ courseId }: { courseId: string }) {
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const start = useCallback(
    async (file: File) => {
      setUploadError(null)
      setRetryFile(null)
      if (file.size > MAX_MEDIA_BYTES) {
        setUploadError(`文件 ${formatSize(file.size)} 超过单文件上限 2GiB，未发起上传`)
        return
      }
      setUploading({ name: file.name, loaded: 0, total: file.size })
      try {
        const created = await createAsset(courseId, file.name, file.size)
        await uploadToTarget({
          target: created.upload,
          file,
          onProgress: (loaded, total) => setUploading({ name: file.name, loaded, total }),
        })
        await refresh()
      } catch (err) {
        setUploadError(err instanceof ApiError ? err.message : '上传失败，请重试')
        setRetryFile(file)
        await refresh()
      } finally {
        setUploading(null)
      }
    },
    [courseId, refresh],
  )

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void start(file)
  }

  return (
    <section>
      {listError ? <div className="notice err">{listError}</div> : null}
      {uploadError ? (
        <div className="notice err">
          {uploadError}
          {retryFile ? (
            <button type="button" className="btn link" onClick={() => void start(retryFile)}>
              重试
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="card upload-card">
        <div className="upload-head">
          <b>上传视频</b>
          <span className="meta">mp4 / mov · 单文件 ≤ 2GiB · 必须含音频轨</span>
        </div>
        <div
          className={dragOver ? 'dropzone over' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <b>把视频拖到这里</b>
          <p>或</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading !== null}
          >
            选择视频文件
          </button>
          <small>上传中断后可以重试，不会产生重复素材。</small>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void start(file)
            }}
          />
        </div>

        {uploading ? (
          <div className="upload-progress">
            <div className="prog">
              <i style={{ width: `${Math.min(100, Math.round((uploading.loaded / uploading.total) * 100))}%` }} />
            </div>
            <span className="meta">
              {uploading.name} · {Math.round((uploading.loaded / uploading.total) * 100)}% ·{' '}
              {formatSize(uploading.loaded)} / {formatSize(uploading.total)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="page-head" style={{ marginTop: 26 }}>
        <div>
          <h2>素材列表</h2>
          <p className="sub">上传完成的录像会出现在这里，作为课程的原始素材。</p>
        </div>
      </div>

      {loading ? (
        <div className="empty">素材加载中…</div>
      ) : assets.length === 0 ? (
        <div className="empty">还没有素材。拖一段课程录像进来试试。</div>
      ) : (
        <div className="cards">
          {assets.map((asset) => (
            <article className="card" key={asset.id}>
              <div className="card-top">
                <b>{asset.fileName}</b>
                <span className={`tag ${asset.status}`}>{STATUS_TEXT[asset.status]}</span>
              </div>
              <div className="meta">
                {asset.id}
                {asset.byteSize !== null ? ` · ${formatSize(asset.byteSize)}` : ''}
                {formatDuration(asset.durationS) ? ` · ${formatDuration(asset.durationS)}` : ''}
                {asset.sha256 ? ` · sha256 ${asset.sha256.slice(0, 12)}…` : ''}
              </div>
              {asset.errorMessage ? <div className="meta err-text">{asset.errorMessage}</div> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
