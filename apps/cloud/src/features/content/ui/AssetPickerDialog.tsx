'use client'

import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import type { MediaAssetView, MediaFrameView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getFrames, listAssets } from '@/features/pipeline/api'
import { getHlsPlayback } from '@/features/production/api'
import { planningReadyOf, understandingCountOf } from '@/features/pipeline/ui/processing'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * 选素材弹窗（方案页对话区空态入口，教师端需求 T7）：首次打开课程、
 * 还没有大纲时，从素材库（全局视角，跨课可选）勾选用于本课制作的视频。
 * 方格墙呈现：封面取素材第一张关键帧（签名取图地址），悬停即签发 HLS
 * 地址静默内联预览（与教材 ClipCard 同一播放链路）；没跑理解的整卡置灰。
 * 确认制作后由调用方把所选素材作为一条用户消息发进对话流——Agent 依此
 * draft_plan 带参触发起草（目标缺失时它会向教师要）。
 */

function durationBadge(seconds: number): string {
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 悬停预览：现签播放地址 + hls.js 静默内联播放；拿不到地址就留在封面。 */
function PreviewVideo({ assetId }: { assetId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    void (async () => {
      try {
        const playback = await getHlsPlayback(assetId)
        if (cancelled) return
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = playback.url
        } else {
          const { default: HlsImpl } = await import('hls.js')
          if (cancelled) return
          if (!HlsImpl.isSupported()) {
            setFailed(true)
            return
          }
          const hls = new HlsImpl()
          hlsRef.current = hls
          hls.loadSource(playback.url)
          hls.attachMedia(video)
        }
        void video.play().catch(() => undefined)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
  }, [assetId])

  if (failed) return null
  return <video ref={videoRef} className="asset-preview" muted playsInline />
}

function AssetCard({
  asset,
  poster,
  picked,
  onToggle,
}: {
  asset: MediaAssetView
  poster: string | null
  picked: boolean
  onToggle: () => void
}) {
  const ready = planningReadyOf(asset)
  const points = understandingCountOf(asset)
  const [preview, setPreview] = useState(false)

  return (
    <div
      className={`asset-card${picked ? ' on' : ''}${ready ? '' : ' off'}`}
      role={ready ? 'button' : undefined}
      tabIndex={ready ? 0 : undefined}
      aria-pressed={ready ? picked : undefined}
      title={ready ? '' : '还没跑完理解——先到素材库重跑理解'}
      onClick={ready ? onToggle : undefined}
      onKeyDown={
        ready
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onToggle()
              }
            }
          : undefined
      }
      onMouseEnter={() => setPreview(true)}
      onMouseLeave={() => setPreview(false)}
    >
      <div className="asset-poster">
        {poster ? (
          <img src={poster} alt="" draggable={false} loading="lazy" />
        ) : (
          <span className="asset-ph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <path d="M10.6 9.6l3.6 2.4-3.6 2.4z" fill="currentColor" stroke="none" />
            </svg>
          </span>
        )}
        {preview ? <PreviewVideo assetId={asset.id} /> : null}
        {asset.durationS !== null ? <span className="asset-dur">{durationBadge(asset.durationS)}</span> : null}
        {picked ? <span className="asset-check">✓</span> : null}
        {!ready ? <span className="asset-off-tag">需重跑理解</span> : null}
      </div>
      <span className="asset-name">{asset.fileName}</span>
      <span className="asset-sub">
        {asset.courseTitle ? `${asset.courseTitle} · ` : ''}
        {ready ? `${points} 要点` : points > 0 ? '理解未完成' : '需重跑理解'}
      </span>
    </div>
  )
}

export function AssetPickerDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  /** 确认制作：带回全部勾选的素材（已过可规划门控）。 */
  onConfirm: (assets: MediaAssetView[]) => void
}) {
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [posters, setPosters] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    setPicked([])
    setPosters({})
    setError(null)
    setLoading(true)
    void listAssets()
      .then(async (items) => {
        if (!alive) return
        setAssets(items)
        // 封面：每份素材取最早一张关键帧（签名取图地址）；取不到就留占位图标。
        const entries = await Promise.all(
          items.map(async (asset): Promise<[string, string] | null> => {
            try {
              const frames = (await getFrames(asset.id)).items
              const first = frames.reduce<MediaFrameView | null>(
                (best, frame) => (!best || frame.atMs < best.atMs ? frame : best),
                null,
              )
              return first ? [asset.id, first.url] : null
            } catch {
              return null
            }
          }),
        )
        if (!alive) return
        setPosters(Object.fromEntries(entries.filter((entry): entry is [string, string] => entry !== null)))
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : '素材列表加载失败')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [open])

  const pickedAssets = assets.filter((asset) => picked.includes(asset.id))
  const canConfirm = pickedAssets.length > 0 && pickedAssets.every(planningReadyOf)

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  function confirm() {
    if (!canConfirm) return
    onClose()
    onConfirm(pickedAssets)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>选择素材，开始制作</DialogTitle>
          <DialogDescription className="sr-only">从素材库勾选用于本课制作的视频</DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-1">
        {error ? (
          <Alert variant="destructive" className="mb-3.5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="empty">素材加载中…</div>
        ) : assets.length === 0 ? (
          <p className="form-note">素材库里还没有可用的视频。</p>
        ) : (
          <div className="asset-grid">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                poster={posters[asset.id] ?? null}
                picked={picked.includes(asset.id)}
                onToggle={() => toggle(asset.id)}
              />
            ))}
          </div>
        )}
        </div>
        <DialogFooter className="gap-2 border-t border-line px-4 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!canConfirm}
            title={pickedAssets.length === 0 ? '先勾选素材' : undefined}
            onClick={confirm}
          >
            确认制作（已选 {pickedAssets.length} 份）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
