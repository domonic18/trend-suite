'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCourses } from './CoursesProvider'
import { NewCourseDialog } from './NewCourseDialog'
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
  const [dialogOpen, setDialogOpen] = useState(false)

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
        <button
          type="button"
          className="card add"
          onClick={() => setDialogOpen(true)}
        >
          ＋ 新建课程
        </button>
      </div>

      <NewCourseDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => void refresh()}
      />
    </section>
  )
}
