'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import type { SourceUnitView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { getHlsPlayback } from '@/features/production/api'

/**
 * 片段卡 :::clip（验收②的播放形态）：素材已产出 HLS 才可播；
 * hls.js 动态 import（仅预览页用），from 秒起播、到 to 秒暂停收起。
 */

export function ClipCard({
  assetId,
  from,
  to,
  caption,
  unit,
}: {
  assetId: string
  from: number
  to: number
  caption: string
  unit: SourceUnitView | undefined
}) {
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)

  const teardown = useCallback(() => {
    hlsRef.current?.destroy()
    hlsRef.current = null
    setSrc(null)
  }, [])

  useEffect(() => () => teardown(), [teardown])

  const play = useCallback(async () => {
    setError(null)
    if (!unit?.playable) {
      setError('该素材尚未产出 HLS，无法回放片段')
      return
    }
    try {
      const playback = await getHlsPlayback(assetId)
      setOpen(true)
      setSrc(playback.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '播放地址签发失败')
    }
  }, [assetId, unit])

  // 挂载播放器：起播定位 from；越过 to 秒即暂停（片段语义）。
  useEffect(() => {
    if (!src || !open) return
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    void (async () => {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
      } else {
        const { default: HlsImpl } = await import('hls.js')
        if (cancelled) return
        if (!HlsImpl.isSupported()) {
          setError('当前浏览器不支持 HLS 回放')
          return
        }
        const hls = new HlsImpl()
        hlsRef.current = hls
        hls.loadSource(src)
        hls.attachMedia(video)
      }
      const onLoaded = () => {
        video.currentTime = from
      }
      const onTime = () => {
        if (video.currentTime >= to) {
          video.pause()
        }
      }
      video.addEventListener('loadeddata', onLoaded)
      video.addEventListener('timeupdate', onTime)
      void video.play().catch(() => undefined)
    })()
    return () => {
      cancelled = true
    }
  }, [src, open, from, to])

  const close = useCallback(() => {
    teardown()
    setOpen(false)
  }, [teardown])

  return (
    <div className="clip-card">
      <div className="clip-head">
        <span className="clip-play" aria-hidden>
          ▶
        </span>
        <div className="grow">
          <b>{caption}</b>
          <small>
            原片 {from}s ~ {to}s 片段
          </small>
        </div>
        {open ? (
          <button type="button" className="btn link" onClick={close}>
            收起
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => void play()}>
            播放片段
          </button>
        )}
      </div>
      {error ? <div className="notice err">{error}</div> : null}
      {open && src ? (
        <div className="clip-video">
          <video ref={videoRef} controls playsInline />
        </div>
      ) : null}
    </div>
  )
}
