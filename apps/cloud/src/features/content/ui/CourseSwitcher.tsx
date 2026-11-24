'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CourseSummaryView } from '@trend-suite/contracts'
import { courseScaleOf, courseStatusTagOf } from './coursePhase'
import { useCourses } from './CoursesProvider'
import { NewCourseDialog } from './NewCourseDialog'

/**
 * 课程切换器（对齐原型 teacher-studio 的 sb-course，Notion / Linear 式）：
 * 按钮常显当前课程与状态，点开浮层列出全部课程（状态点 + 规模 + 当前项打勾），
 * 选中即跳转；Esc / 点击外部关闭。浮层 fixed 定位以逃出侧栏裁剪。
 */

function dotClassOf(course: CourseSummaryView): string {
  const tone = courseStatusTagOf(course).tone
  if (tone === 'run') return 'dot-run'
  if (tone === 'ok') return 'dot-ok'
  if (tone === 'warn') return 'dot-wait'
  return 'dot-idle'
}

export function CourseSwitcher({ current }: { current: CourseSummaryView }) {
  const { courses, refresh } = useCourses()
  const router = useRouter()
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    const place = () => {
      const btn = btnRef.current
      const pop = popRef.current
      if (!btn || !pop) return
      const r = btn.getBoundingClientRect()
      pop.style.width = `${Math.max(Math.round(r.width) + 36, 236)}px`
      pop.style.left = `${Math.round(r.left)}px`
      const h = pop.offsetHeight
      const below = r.bottom + 6 + h > window.innerHeight - 8
      pop.style.top = below ? `${Math.max(8, Math.round(r.top - 6 - h))}px` : `${Math.round(r.bottom + 6)}px`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node
      if (!popRef.current?.contains(target) && !btnRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tag = courseStatusTagOf(current)
  const progress =
    current.sectionCount > 0 ? ` · ${current.doneSectionCount}/${current.sectionCount} 节` : ''

  return (
    <div className="sb-course">
      <button
        ref={btnRef}
        type="button"
        className="sbc-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="切换课程"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`sb-dot ${dotClassOf(current)}`} />
        <span className="sbc-t">
          <b>{current.title}</b>
          <small>
            {tag.text}
            {progress}
          </small>
        </span>
        <svg className="sbc-chev" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6.5l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div ref={popRef} className={`sbc-pop${open ? ' open' : ''}`} role="menu" aria-label="切换课程">
        <div className="sbc-h">切换课程</div>
        {courses.map((course) => (
          <button
            key={course.id}
            type="button"
            role="menuitemradio"
            aria-checked={course.id === current.id}
            className={`sbc-i${course.id === current.id ? ' on' : ''}`}
            onClick={() => {
              setOpen(false)
              router.push(`/workbench/courses/${course.id}`)
            }}
          >
            <span className={`sb-dot ${dotClassOf(course)}`} />
            <span className="sbc-t">
              <b>{course.title}</b>
              <small>{courseScaleOf(course)}</small>
            </span>
            <svg className="sbc-chk" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3.5 8.5l3 3 6-6.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}
        <div className="sbc-f">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
          >
            ＋ 新建课程
          </button>
        </div>
      </div>
      <NewCourseDialog open={creating} onClose={() => setCreating(false)} onCreated={() => void refresh()} />
    </div>
  )
}
