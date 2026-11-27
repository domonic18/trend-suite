'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, RotateCw } from 'lucide-react'
import { MAX_MEDIA_BYTES } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { createAsset, ingestAsset, uploadToTarget } from '../api'
import { formatSize } from './format'

/**
 * 上传区（教师端需求 T4）：素材独立上传入库，不选课程——
 * 归属关系在建课勾选素材时建立。支持多选 / 多文件拖入：排队**顺序**上传
 * （单文件可达 2GiB，并行会挤占带宽且难以归因），逐文件进度可见，
 * 单个失败不影响其余、可单独重试。上传完成即自动入队加工
 * （转写 → 关键帧 → 理解三段）。
 */

type UploadItem = {
  key: string
  name: string
  size: number
  status: 'waiting' | 'uploading' | 'done' | 'failed'
  loaded: number
  error?: string
  /** 可上传的项保留文件；非视频 / 超限的失败项无文件（不可重试）。 */
  file?: File
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i
const isVideo = (file: File) => file.type.startsWith('video/') || VIDEO_EXT.test(file.name)

export function MaterialUploader({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const queueRef = useRef<UploadItem[]>([])
  const runningRef = useRef(false)

  type Patch = { [K in keyof UploadItem]?: UploadItem[K] | undefined }
  /** 局部更新；值为 undefined 的键表示清除该字段。 */
  function patch(key: string, next: Patch) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.key !== key) return item
        const merged: UploadItem = { ...item }
        for (const k of Object.keys(next) as Array<keyof UploadItem>) {
          if (next[k] === undefined) delete merged[k]
          else Object.assign(merged, { [k]: next[k] })
        }
        return merged
      }),
    )
  }

  function enqueue(files: File[]) {
    const created: UploadItem[] = files.map((file) => {
      const item: UploadItem = {
        key: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        status: 'waiting',
        loaded: 0,
        file,
      }
      if (!isVideo(file)) {
        item.status = 'failed'
        item.error = '不是视频文件'
        delete item.file
      } else if (file.size > MAX_MEDIA_BYTES) {
        item.status = 'failed'
        item.error = `超过单文件上限 ${formatSize(MAX_MEDIA_BYTES)}`
        delete item.file
      }
      return item
    })
    queueRef.current.push(...created.filter((item) => item.status === 'waiting'))
    // 新一批开始时清掉上一批已完成的行（失败行保留，便于重试）
    setItems((prev) => [...prev.filter((item) => item.status !== 'done'), ...created])
    void runQueue()
  }

  async function runQueue() {
    if (runningRef.current) return
    runningRef.current = true
    try {
      for (let item = queueRef.current.shift(); item; item = queueRef.current.shift()) {
        await uploadOne(item)
      }
    } finally {
      runningRef.current = false
    }
  }

  async function uploadOne(item: UploadItem) {
    const file = item.file
    if (!file) return
    patch(item.key, { status: 'uploading', loaded: 0 })
    try {
      const created = await createAsset(file.name, file.size)
      await uploadToTarget({
        target: created.upload,
        file,
        onProgress: (loaded) => patch(item.key, { loaded }),
      })
      // 上传完成即入队加工：转写与抽帧在后台跑（arch/05 §3.7）。
      await ingestAsset(created.asset.id).catch(() => undefined)
      patch(item.key, { status: 'done', loaded: file.size })
      await onDone()
    } catch (err) {
      patch(item.key, { status: 'failed', error: err instanceof ApiError ? err.message : '上传失败' })
    }
  }

  function retry(item: UploadItem) {
    patch(item.key, { status: 'waiting', loaded: 0, error: undefined })
    queueRef.current.push(item)
    void runQueue()
  }

  // 卸载时清空待上传队列（在途上传由浏览器决定是否中断）
  useEffect(() => () => {
    queueRef.current.splice(0)
  }, [])

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) enqueue(files)
  }

  const uploading = items.some((item) => item.status === 'uploading')

  return (
    <div className="card upload-card">
      <div className="upload-head">
        <b>上传视频</b>
        <span className="meta">mp4 / mov · 单文件 ≤ 2GiB · 可多选</span>
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
        <Button onClick={() => inputRef.current?.click()}>选择视频文件</Button>
        <small>上传后自动转写、抽帧与理解，做课时再勾选素材。</small>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (files.length > 0) enqueue(files)
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="mt-3.5 grid gap-2" aria-live="polite">
          {items.map((item) => {
            const pct = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0
            return (
              <li
                key={item.key}
                className="grid gap-1.5 rounded-lg border border-line bg-bg px-3 py-2 text-[12.5px]"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={item.name}>
                    {item.name}
                  </span>
                  <span className="shrink-0 text-xs text-mut">{formatSize(item.size)}</span>
                  {item.status === 'done' ? (
                    <span className="flex shrink-0 items-center gap-1 text-success">
                      <Check className="size-3.5" aria-hidden="true" /> 已上传
                    </span>
                  ) : item.status === 'failed' ? (
                    item.file ? (
                      <Button
                        variant="link"
                        size="sm"
                        className="shrink-0"
                        onClick={() => retry(item)}
                      >
                        <RotateCw className="size-3.5" aria-hidden="true" /> 重试
                      </Button>
                    ) : null
                  ) : (
                    <span className="shrink-0 text-xs text-mut tabular-nums">
                      {item.status === 'uploading' ? `${pct}%` : '排队中'}
                    </span>
                  )}
                </div>
                {item.status === 'uploading' ? <Progress value={pct} aria-label={`${item.name} 上传进度`} /> : null}
                {item.error ? <span className="text-xs text-destructive">{item.error}</span> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
