'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { CSSProperties } from 'react'
import type { CourseSummaryView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { deleteCourse, renameCourse } from '../api'
import { useCourses } from './CoursesProvider'
import { NewCourseDialog } from './NewCourseDialog'
import {
  courseScaleOf,
  courseStatusTagOf,
  nextActionOf,
  progressOf,
} from './coursePhase'

function formatTime(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const md = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const hm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return sameYear ? `${md} ${hm}` : `${date.getFullYear()}-${md} ${hm}`
}

/** 封面色相（借鉴 SasanImmersive 课程卡）：课程 id 哈希出稳定 hue，无封面图也有视觉锚点。 */
function coverHueOf(id: string): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 360
  return hash
}

export function CourseList() {
  const { courses, loading, error, refresh } = useCourses()
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<CourseSummaryView | null>(null)
  const [deleting, setDeleting] = useState<CourseSummaryView | null>(null)

  return (
    <section>
      {error ? <div className="notice err">{error}</div> : null}

      {loading ? (
        <div className="empty">课程加载中…</div>
      ) : courses.length === 0 ? (
        <div className="empty">还没有课程。</div>
      ) : (
        <div className="cards">
          {courses.map((course) => {
            const tag = courseStatusTagOf(course)
            const next = nextActionOf(course)
            const progress = Math.round(progressOf(course) * 100)
            return (
              <article
                className="card clickable"
                key={course.id}
                style={{ '--cover-hue': coverHueOf(course.id) } as CSSProperties}
              >
                <Link className="card-go" href={`/workbench/courses/${course.id}`} aria-label={`进入课程 ${course.title}`} />
                <div className="card-cover" aria-hidden="true">
                  <span className="card-mono">{Array.from(course.title)[0] ?? '课'}</span>
                </div>
                <div className="card-body">
                  <div className="card-top">
                    <b>{course.title}</b>
                    <span className={`tag ${tag.tone}`}>{tag.text}</span>
                  </div>
                  <div className="meta">{courseScaleOf(course)}</div>
                  <div className="prog" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="制作进度">
                    <i style={{ width: `${progress}%` }} />
                  </div>
                  <div className="meta card-hint" title={next.hint}>{next.hint}</div>
                  <div className="foot">
                    <span>创建于 {formatTime(course.createdAt)}</span>
                    <span className="btn link">进入课程 →</span>
                  </div>
                </div>
                <span className="card-acts">
                  <button
                    type="button"
                    className="btn link"
                    title="改名"
                    aria-label={`改名 ${course.title}`}
                    onClick={() => setRenaming(course)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="btn link danger"
                    title="删除"
                    aria-label={`删除 ${course.title}`}
                    onClick={() => setDeleting(course)}
                  >
                    ✕
                  </button>
                </span>
              </article>
            )
          })}
        </div>
      )}

      <div className="cards" style={{ marginTop: 14 }}>
        <button type="button" className="card add" onClick={() => setCreating(true)}>
          ＋ 新建课程
        </button>
      </div>

      <NewCourseDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => void refresh()}
      />
      <RenameDialog course={renaming} onClose={() => setRenaming(null)} onDone={() => void refresh()} />
      <DeleteDialog course={deleting} onClose={() => setDeleting(null)} onDone={() => void refresh()} />
    </section>
  )
}

/** 改名弹窗：一行输入，保存即 PATCH。 */
function RenameDialog({
  course,
  onClose,
  onDone,
}: {
  course: CourseSummaryView | null
  onClose: () => void
  onDone: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (course && !el.open) {
      setTitle(course.title)
      setError(null)
      el.showModal()
      inputRef.current?.focus()
    }
    if (!course && el.open) el.close()
  }, [course])

  async function submit() {
    if (!course || !title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await renameCourse(course.id, title.trim())
      el_close()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '改名失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function el_close() {
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} onClick={(e) => e.target === dialogRef.current && el_close()}>
      <div className="dialog-head">
        <b>课程改名</b>
        <button type="button" className="x" aria-label="关闭" onClick={el_close}>
          ×
        </button>
      </div>
      <div className="dialog-body">
        <div className="field">
          <label htmlFor="rename-title">课程名称</label>
          <input
            id="rename-title"
            ref={inputRef}
            className="input"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        {error ? <div className="notice err">{error}</div> : null}
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn" onClick={el_close}>
          取消
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !title.trim() || title.trim() === course?.title}
          onClick={() => void submit()}
        >
          保存
        </button>
      </div>
    </dialog>
  )
}

/** 删除确认：说明级联后果，确认才删。 */
function DeleteDialog({
  course,
  onClose,
  onDone,
}: {
  course: CourseSummaryView | null
  onClose: () => void
  onDone: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (course && !el.open) {
      setError(null)
      el.showModal()
    }
    if (!course && el.open) el.close()
  }, [course])

  async function submit() {
    if (!course || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteCourse(course.id)
      dialogRef.current?.close()
      onClose()
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请稍后再试')
      setBusy(false)
    }
  }

  function el_close() {
    dialogRef.current?.close()
    onClose()
  }

  return (
    <dialog ref={dialogRef} onClose={onClose} onClick={(e) => e.target === dialogRef.current && el_close()}>
      <div className="dialog-head">
        <b>删除课程</b>
        <button type="button" className="x" aria-label="关闭" onClick={el_close}>
          ×
        </button>
      </div>
      <div className="dialog-body">
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.8 }}>
          将删除课程<b>{course ? `「${course.title}」` : ''}</b>
          ，连同它的全部素材、方案、生产产物与 Agent 对话记录，<b>不可恢复</b>。
        </p>
        {error ? <div className="notice err">{error}</div> : null}
      </div>
      <div className="dialog-foot">
        <button type="button" className="btn" onClick={el_close}>
          取消
        </button>
        <button type="button" className="btn danger" disabled={busy} onClick={() => void submit()}>
          确认删除
        </button>
      </div>
    </dialog>
  )
}
