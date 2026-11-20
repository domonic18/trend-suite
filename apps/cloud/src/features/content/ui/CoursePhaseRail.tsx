'use client'

import Link from 'next/link'
import { phasePathOf, type CoursePhase, type CoursePhaseKey } from './coursePhase'

/**
 * 竖排阶段轨：这门课的四段流程与各自的状态。
 *
 * 阶段轨就是导航——不再另设一排页内标签，两套导航并排只会让人不知道该点哪个。
 */
export function CoursePhaseRail(props: {
  phases: CoursePhase[]
  active: CoursePhaseKey
  courseId: string
}) {
  return (
    <nav className="wb-rail" aria-label="课程阶段">
      {props.phases.map((phase) => {
        const href = phasePathOf(props.courseId, phase.key)
        const body = (
          <>
            <span className={`wb-dot ${phase.state}`} aria-hidden="true" />
            <span className="wb-phase-text">
              <b>{phase.label}</b>
              <small>{phase.hint}</small>
            </span>
          </>
        )
        if (!href) {
          return (
            <span className={`wb-phase ${phase.state} soon`} key={phase.key} aria-disabled="true">
              {body}
            </span>
          )
        }
        return (
          <Link
            className={`wb-phase ${phase.state} ${phase.key === props.active ? 'on' : ''}`}
            href={href}
            key={phase.key}
            aria-current={phase.key === props.active ? 'page' : undefined}
          >
            {body}
          </Link>
        )
      })}
    </nav>
  )
}
