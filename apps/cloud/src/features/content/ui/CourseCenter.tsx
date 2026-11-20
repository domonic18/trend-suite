'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { useCourses } from './CoursesProvider'
import {
  coursePhases,
  nextActionOf,
  phaseOfPath,
  phasePathOf,
} from './coursePhase'
import { CoursePhaseRail } from './CoursePhaseRail'

/**
 * 课程中心：一门课的全部流程收在一页里。
 *
 * 左侧竖排阶段轨 + 常驻的「下一步该干什么」+ 当前阶段的内容。
 * 阶段轨即导航，老的深链（/plan、/production）仍可直接进来。
 */
export function CourseCenter(props: { courseId: string; children: ReactNode }) {
  const pathname = usePathname()
  const { courses, loading } = useCourses()
  const current = courses.find((course) => course.id === props.courseId) ?? null
  const active = phaseOfPath(pathname)
  const phases = current ? coursePhases(current) : []
  const activePhase = phases.find((phase) => phase.key === active)
  const next = current ? nextActionOf(current) : null
  const nextHref = next ? phasePathOf(props.courseId, next.phase) : null

  return (
    <div className="wb-center">
      <CoursePhaseRail phases={phases} active={active} courseId={props.courseId} />
      <div className="wb-content">
        <div className="page-head">
          <div>
            <h1>{activePhase?.title ?? '课程'}</h1>
            <p className="sub">{activePhase?.desc ?? ''}</p>
          </div>
        </div>

        {next && nextHref ? (
          <div className="wb-next">
            <div className="wb-next-t">
              <span className="wb-next-k">下一步</span>
              <b>{next.label}</b>
              <small>{next.hint}</small>
            </div>
            {nextHref === pathname ? (
              <span className="wb-next-here">就在这一步</span>
            ) : (
              <Link className="btn primary" href={nextHref}>
                前往
              </Link>
            )}
          </div>
        ) : null}

        {loading && !current ? (
          <div className="skeleton-page" aria-busy="true">
            <div className="sk sk-card" />
            <div className="sk sk-card" />
          </div>
        ) : (
          props.children
        )}
      </div>
    </div>
  )
}
