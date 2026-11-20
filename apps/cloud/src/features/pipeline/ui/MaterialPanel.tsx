'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_MEDIA_BYTES,
  type MediaAssetView,
  type MediaFrameView,
  type TranscriptResponse,
} from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { IconTrash } from '@/features/lib/icons'
import {
  cancelMaterial,
  createAsset,
  deleteMaterial,
  getFrames,
  getTranscript,
  ingestAsset,
  listAssets,
  rerunUnderstand,
  retryAsset,
  uploadToTarget,
} from '../api'
import { FrameGrid } from './FrameGrid'
import { ProcessingSteps } from './ProcessingSteps'
import { READINESS_TEXT, readinessOf } from './processing'
import { TranscriptView } from './TranscriptView'

type Uploading = { name: string; loaded: number; total: number }

type Detail = {
  transcript: TranscriptResponse | null
  frames: MediaFrameView[]
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
  const [actionError, setActionError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, Detail>>({})
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

  const loadDetail = useCallback(async (assetId: string) => {
    const [transcript, frames] = await Promise.all([
      getTranscript(assetId).catch(() => null),
      getFrames(assetId).catch(() => ({ items: [] })),
    ])
    setDetail((prev) => ({ ...prev, [assetId]: { transcript, frames: frames.items } }))
  }, [])

  /** 加工中的素材：轮询状态，转写中的段落边转边读。 */
  const running = assets.some((a) => {
    const r = readinessOf(a)
    return r === 'running' || r === 'queued'
  })

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void refresh()
      if (expanded) void loadDetail(expanded)
    }, 3_000)
    return () => clearInterval(timer)
  }, [running, expanded, refresh, loadDetail])

  function toggle(assetId: string) {
    const next = expanded === assetId ? null : assetId
    setExpanded(next)
    if (next) void loadDetail(next)
  }

  const start = useCallback(
    async (file: File) => {
      setUploadError(null)
      setActionError(null)
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
        // 上传完成即入队加工：转写与抽帧在后台跑（arch/05 §3.7）。
        await ingestAsset(created.asset.id).catch(() => undefined)
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

  /** 重试：只补没做完的部分，已转好的块不重算。 */
  const retry = useCallback(
    async (assetId: string) => {
      setActionError(null)
      try {
        await retryAsset(assetId)
        await refresh()
        await loadDetail(assetId)
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : '重试失败，请稍后再试')
      }
    },
    [refresh, loadDetail],
  )

  /** 停止加工（T19）：排队中直接取消；运行中在当前阶段边界安全中止，已转产物保留。 */
  const stop = useCallback(
    async (assetId: string) => {
      setActionError(null)
      try {
        await cancelMaterial(assetId)
        await refresh()
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : '停止失败，请稍后再试')
      }
    },
    [refresh],
  )

  /** 重跑理解（迭代 8）：只补理解阶段，规划要用素材的教学要点。 */
  const understand = useCallback(
    async (assetId: string) => {
      setActionError(null)
      try {
        await rerunUnderstand(assetId)
        await refresh()
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : '重跑理解失败，请稍后再试')
      }
    },
    [refresh],
  )

  /** 删除素材（T20）：行、段落、关键帧与字节一并清理，不可恢复。 */
  const remove = useCallback(
    async (assetId: string) => {
      setActionError(null)
      try {
        await deleteMaterial(assetId)
        setDetail((prev) => {
          const next = { ...prev }
          delete next[assetId]
          return next
        })
        if (expanded === assetId) setExpanded(null)
        await refresh()
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : '删除失败，请稍后再试')
      }
    },
    [refresh, expanded],
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
      {actionError ? <div className="notice err">{actionError}</div> : null}

      <div className="card upload-card">
        <div className="upload-head">
          <b>上传视频</b>
          <span className="meta">mp4 / mov · 单文件 ≤ 2GiB · 必须含音频轨</span>
        </div>
        <p className="form-note">
          上传的视频属于<b>这门课</b>；一门课可以上传多个视频，
          默认全部参与规划（起草方案时可勾选其中几份）。
          {assets.length > 0 ? `本课已有 ${assets.length} 个素材。` : ''}
        </p>
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
          <small>上传后自动转写、抽取关键帧；转写中的内容可以边转边读。</small>
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
          <h2>视频与转写</h2>
          <p className="sub">上传完成的录像会在这里自动转写并抽取关键帧。</p>
        </div>
      </div>

      {loading ? (
        <div className="empty">素材加载中…</div>
      ) : assets.length === 0 ? (
        <div className="empty">还没有素材。拖一段课程录像进来试试。</div>
      ) : (
        <div className="mat-list">
          {assets.map((asset) => {
            const readiness = readinessOf(asset)
            const view = detail[asset.id]
            const isOpen = expanded === asset.id
            return (
              <article className="card mat" key={asset.id}>
                <div className="up-row">
                  <div className="ut">
                    <b>{asset.fileName}</b>
                    <span>
                      {asset.id}
                      {asset.byteSize !== null ? ` · ${formatSize(asset.byteSize)}` : ''}
                      {formatDuration(asset.durationS) ? ` · ${formatDuration(asset.durationS)}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className={`st st-${readiness}`}>
                      <i />
                      {READINESS_TEXT[readiness]}
                    </span>
                    <span className="pct">
                      {readiness === 'ready'
                        ? `${asset.segmentCount} 段 · ${asset.frameCount} 关键帧`
                        : (asset.processMessage ?? '')}
                    </span>
                  </div>
                  <div>
                    <div className={readiness === 'failed' ? 'prog err' : 'prog'}>
                      <i style={{ width: `${Math.round(asset.processProgress)}%` }} />
                    </div>
                    <span className="pct">
                      {Math.round(asset.processProgress)}%{readiness === 'ready' ? ' · 就绪' : ''}
                    </span>
                  </div>
                  <div className="ua">
                    <button type="button" className="btn link" onClick={() => toggle(asset.id)}>
                      {isOpen ? '收起' : '展开'}
                    </button>
                    {readiness === 'queued' || readiness === 'running' ? (
                      <button
                        type="button"
                        className="btn link"
                        onClick={() => {
                          if (window.confirm('停止加工？排队任务直接取消，运行中的在阶段边界安全中止，已转出的段落与关键帧会保留。')) {
                            void stop(asset.id)
                          }
                        }}
                      >
                        停止
                      </button>
                    ) : null}
                    {readiness === 'stopped' ? (
                      <button
                        type="button"
                        className="btn link"
                        onClick={() => void retry(asset.id)}
                      >
                        重新加工
                      </button>
                    ) : null}
                    {readiness === 'ready' ? (
                      <button
                        type="button"
                        className="btn link"
                        onClick={() => void understand(asset.id)}
                      >
                        重跑理解
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="iconbtn danger"
                      title="删除素材"
                      aria-label="删除素材"
                      onClick={() => {
                        if (window.confirm(`删除素材「${asset.fileName}」？段落、关键帧与文件字节将一并清理，不可恢复。`)) {
                          void remove(asset.id)
                        }
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>

                {readiness === 'failed' ? (
                  <div className="notice err">
                    {asset.errorMessage ?? '加工失败'}
                    <button type="button" className="btn link" onClick={() => void retry(asset.id)}>
                      重试（不重算已完成部分）
                    </button>
                  </div>
                ) : null}

                {isOpen ? (
                  <div className="mdetail">
                    <ProcessingSteps asset={asset} />
                    <div>
                      <h4>
                        ASR 逐字稿
                        <span className="tag gray">
                          {view?.transcript ? view.transcript.segments.length : asset.segmentCount} 段
                        </span>
                      </h4>
                      {view?.transcript ? (
                        <TranscriptView transcript={view.transcript} />
                      ) : (
                        <div className="empty">逐字稿加载中…</div>
                      )}
                    </div>
                    <div>
                      <h4>
                        关键帧
                        <span className="tag gray">
                          {view ? view.frames.length : asset.frameCount} 张
                        </span>
                      </h4>
                      {view ? (
                        <FrameGrid frames={view.frames} />
                      ) : (
                        <div className="empty">关键帧加载中…</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
