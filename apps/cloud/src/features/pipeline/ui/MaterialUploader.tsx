'use client'

import { useEffect, useRef, useState } from 'react'
import { MAX_MEDIA_BYTES } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { createAsset, ingestAsset, uploadToTarget } from '../api'
import { formatSize } from './format'

/**
 * 上传区（教师端需求 T4）：
 * - 全局素材库里先选「归属课程」，课程内视图归属固定；
 * - 上传完成后自动入队加工（转写 → 关键帧 → 理解三段）。
 */

type Uploading = { name: string; loaded: number; total: number }

export function MaterialUploader(props: {
  /** 可选归属课程（全局素材库模式）；课程内模式用 fixedCourseId。 */
  courses?: { id: string; title: string }[]
  fixedCourseId?: string | undefined
  onDone: () => void
}) {
  const { courses = [], fixedCourseId, onDone } = props
  const [courseId, setCourseId] = useState(fixedCourseId ?? '')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 课程列表是异步到的：默认落在第一门课（课程内模式则是固定的那门）。
  useEffect(() => {
    if (fixedCourseId) {
      setCourseId(fixedCourseId)
      return
    }
    setCourseId((prev) => (prev && courses.some((c) => c.id === prev) ? prev : (courses[0]?.id ?? '')))
  }, [courses, fixedCourseId])

  async function start(file: File) {
    setUploadError(null)
    setRetryFile(null)
    const targetCourse = fixedCourseId ?? courseId
    if (!targetCourse) {
      setUploadError('先选择这份视频归属的课程')
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setUploadError(`文件 ${formatSize(file.size)} 超过单文件上限 2GiB，未发起上传`)
      return
    }
    setUploading({ name: file.name, loaded: 0, total: file.size })
    try {
      const created = await createAsset(targetCourse, file.name, file.size)
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

      {!fixedCourseId ? (
        <div className="upload-course">
          <label htmlFor="upload-course">这份视频属于哪门课</label>
          <select
            id="upload-course"
            className="input"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            {courses.length === 0 ? <option value="">（还没有课程）</option> : null}
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
          </select>
          <span className="form-note">
            素材归属课程是硬约束：一门课可上传多个视频，默认全部参与规划（起草时可勾选其中几份）。
          </span>
        </div>
      ) : (
        <p className="form-note">
          上传的视频属于<b>这门课</b>；一门课可以上传多个视频，默认全部参与规划（起草方案时可勾选其中几份）。
        </p>
      )}

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
        <small>
          上传后自动转写、抽取关键帧并做视频理解；转写中的内容可以边转边读。
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
  )
}
