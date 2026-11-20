'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ApiError } from '@/features/lib/http'
import { createCourse } from '../api'
import { useCourses } from './CoursesProvider'
import {
  courseScaleOf,
  courseStatusTagOf,
  nextActionOf,
  phasePathOf,
  progressOf,
} from './coursePhase'

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso))
}

export function CourseList() {
  const { courses, loading, error, refresh } = useCourses()
  const [title, setTitle] = useState('')
  const [outlineText, setOutlineText] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  function openDialog() {
    setTitle('')
    setOutlineText('')
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
      await createCourse(title.trim(), outlineText.trim() || undefined)
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
        <div className="empty">
          还没有课程。新建课程后即可上传素材、生成教材。
          <br />
          上传的视频属于这门课——一门课可以上传多个视频，默认全部参与规划（起草时可勾选）。
        </div>
      ) : (
        <div className="cards">
          {courses.map((course) => {
            const tag = courseStatusTagOf(course)
            const next = nextActionOf(course)
            const href = phasePathOf(course.id, next.phase) ?? `/workbench/courses/${course.id}`
            return (
              <article className="card" key={course.id}>
                <div className="card-top">
                  <b>{course.title}</b>
                  <span className={`tag ${tag.tone}`}>{tag.text}</span>
                </div>
                <div className="meta">{courseScaleOf(course)}</div>
                <div className="prog">
                  <i style={{ width: `${Math.round(progressOf(course) * 100)}%` }} />
                </div>
                <div className="meta">{next.hint}</div>
                <div className="foot">
                  <span>创建于 {formatTime(course.createdAt)}</span>
                  <Link className="btn link" href={href}>
                    {next.label} →
                  </Link>
                </div>
              </article>
            )
          })}
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
          <div className="field">
            <label htmlFor="course-outline">课程目录（可选）</label>
            <textarea
              id="course-outline"
              className="input"
              rows={5}
              value={outlineText}
              maxLength={20000}
              placeholder={'第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义'}
              onChange={(e) => setOutlineText(e.target.value)}
            />
            <p className="form-note">
              有现成的三级目录（篇 / 章 / 课时）就粘进来——起草方案时直接用它做骨架，
              目录是你说了算，Agent 只在它上面挂出处。留空则由 Agent 依据课程目标与素材代拟。
            </p>
          </div>
          <p className="form-note">
            接下来在本课程页上传视频：视频属于这门课，一门课可以上传多个视频，
            默认全部参与规划（起草时可勾选其中几份）。
          </p>
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
