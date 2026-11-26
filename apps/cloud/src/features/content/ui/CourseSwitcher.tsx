'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CourseSummaryView } from '@trend-suite/contracts'
import { Check, Plus } from 'lucide-react'
import { courseScaleOf, courseStatusTagOf } from './coursePhase'
import { useCourses } from './CoursesProvider'
import { NewCourseDialog } from './NewCourseDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * 课程切换器（对齐原型 teacher-studio 的 sb-course，Notion / Linear 式）：
 * 按钮常显当前课程与状态，点开浮层列出全部课程（状态点 + 规模 + 当前项打勾），
 * 选中即跳转。定位 / Esc / 外点关闭由 Radix DropdownMenu 承接。
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
  const [creating, setCreating] = useState(false)

  const tag = courseStatusTagOf(current)
  const progress =
    current.sectionCount > 0 ? ` · ${current.doneSectionCount}/${current.sectionCount} 节` : ''

  return (
    <div className="sb-course">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="sbc-btn" aria-label="切换课程">
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="sbc-pop w-[264px]" aria-label="切换课程">
          <div className="sbc-h">切换课程</div>
          {courses.map((course) => (
            <DropdownMenuItem
              key={course.id}
              aria-checked={course.id === current.id}
              onSelect={() => router.push(`/workbench/courses/${course.id}`)}
              className={`sbc-i${course.id === current.id ? ' on' : ''}`}
            >
              <span className={`sb-dot ${dotClassOf(course)}`} />
              <span className="sbc-t">
                <b>{course.title}</b>
                <small>{courseScaleOf(course)}</small>
              </span>
              {course.id === current.id ? (
                <Check className="sbc-chk size-3.5" aria-hidden="true" />
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)} className="sbc-f">
            <Plus className="size-3.5" aria-hidden="true" /> 新建课程
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewCourseDialog open={creating} onClose={() => setCreating(false)} onCreated={() => void refresh()} />
    </div>
  )
}
