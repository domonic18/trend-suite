'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ApiError } from '@/features/lib/http'
import { createCourse } from '../api'
import { useCourses } from './CoursesProvider'

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function CourseList() {
  const { courses, loading, error, refresh } = useCourses()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  function openDialog() {
    setTitle('')
    setDialogError(null)
    dialogRef.current?.showModal()
  }

  async function onCreate() {
    if (!title.trim()) {
      setDialogError('课程名称必填')
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      await createCourse(title.trim())
      dialogRef.current?.close()
      await refresh()
    } catch (err) {
      setDialogError(err instanceof ApiError ? err.message : '创建课程失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      {error ? <div className="notice err">{error}</div> : null}

      {loading ? (
        <div className="empty">课程加载中…</div>
      ) : courses.length === 0 ? (
        <div className="empty">还没有课程。新建课程后即可上传素材、生成教材。</div>
      ) : (
        <div className="cards">
          {courses.map((course) => (
            <article className="card" key={course.id}>
              <div className="card-top">
                <b>{course.title}</b>
                <span className={`tag ${course.status}`}>
                  {course.status === 'published' ? '已发布' : '草稿'}
                </span>
              </div>
              <div className="meta">创建于 {formatTime(course.createdAt)}</div>
              <div className="foot">
                <span>课程 ID {course.id}</span>
                <Link className="btn link" href={`/workbench/courses/${course.id}`}>
                  上传素材
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="cards" style={{ marginTop: 14 }}>
        <button type="button" className="card add" onClick={openDialog}>
          ＋ 新建课程
        </button>
      </div>

      <dialog ref={dialogRef}>
        <div className="dialog-head">
          <b>新建课程</b>
          <button
            type="button"
            className="x"
            aria-label="关闭"
            onClick={() => dialogRef.current?.close()}
          >
            ×
          </button>
        </div>
        <div className="dialog-body">
          {dialogError ? <div className="notice err">{dialogError}</div> : null}
          <div className="field">
            <label htmlFor="course-title">课程名称</label>
            <input
              id="course-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：总论卷"
              autoFocus
            />
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={onCreate} disabled={busy}>
            {busy ? '创建中…' : '创建课程'}
          </button>
        </div>
      </dialog>
    </section>
  )
}
