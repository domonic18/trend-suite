'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

import { useRef, useState } from 'react'
import { MAX_MEDIA_BYTES } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { createAsset, ingestAsset, uploadToTarget } from '../api'
import { formatSize } from './format'

/**
 * 上传区（教师端需求 T4）：素材独立上传入库，不选课程——
 * 归属关系在建课勾选素材时建立。上传完成后自动入队加工
 * （转写 → 关键帧 → 理解三段）。
 */

type Uploading = { name: string; loaded: number; total: number }

export function MaterialUploader({ onDone }: { onDone: () => void }) {
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function start(file: File) {
    setUploadError(null)
    setRetryFile(null)
    if (file.size > MAX_MEDIA_BYTES) {
      setUploadError(`文件 ${formatSize(file.size)} 超过单文件上限 2GiB，未发起上传`)
      return
    }
    setUploading({ name: file.name, loaded: 0, total: file.size })
    try {
      const created = await createAsset(file.name, file.size)
      await uploadToTarget({
        target: created.upload,
        file,
        onProgress: (loaded, total) => setUploading({ name: file.name, loaded, total }),
      })
      // 上传完成即入队加工：转写与抽帧在后台跑（arch/05 §3.7）。
      await ingestAsset(created.asset.id).catch(() => undefined)
      await onDone()
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : '上传失败，请重试')
      setRetryFile(file)
    } finally {
      setUploading(null)
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void start(file)
  }

  return (
    <div className="card upload-card">
      <div className="upload-head">
        <b>上传视频</b>
        <span className="meta">mp4 / mov · 单文件 ≤ 2GiB · 必须含音频轨</span>
      </div>

      {uploadError ? (
        <Alert variant="destructive" className="mb-3.5">
      <AlertDescription>{uploadError}
          {retryFile ? (
            <Button variant="link" size="sm" onClick={() => void start(retryFile)}>
              重试
            </Button>
          ) : null}</AlertDescription>
    </Alert>
      ) : null}

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
        <Button onClick={() => inputRef.current?.click()} disabled={uploading !== null}>
          选择视频文件
        </Button>
        <small>
          上传后自动转写、抽取关键帧并做视频理解；转写中的内容可以边转边读。做课时再勾选素材。
        </small>
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
          <Progress value={Math.min(100, Math.round((uploading.loaded / uploading.total) * 100))} />
          <span className="meta">
            {uploading.name} · {Math.round((uploading.loaded / uploading.total) * 100)}% ·{' '}
            {formatSize(uploading.loaded)} / {formatSize(uploading.total)}
          </span>
        </div>
      ) : null}
    </div>
  )
}
