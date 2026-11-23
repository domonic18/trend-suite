'use client'

import { useMemo, useState } from 'react'
import type { PlanLessonView, PlanSectionNodeView } from '@trend-suite/contracts'
import { countOutlineLevels } from '@trend-suite/contracts'
import { IconCheck, IconClose } from '@/features/lib/icons'
import { buildOutlineTree, descendantLessonCounts, siblingInfoOf } from './outlineGroup'
import { evidenceDetailLinesOf, formatClock } from './planAudit'

/**
 * 课程大纲（唯一载体）：一棵树就是大纲本体。
 *
 * 行即节点——篇 / 章 / 课时三层，篇与章可折叠；课行带匹配度、时长与出处 chip，
 * 改名 / 挪位 / 删节 / 加课时都直接接微调端点，即时生效。
 */
export function OutlineTree({
  nodes,
  lessons,
  coverage = null,
  onRename,
  onRemove,
  onAdd,
  onMove,
  onSetGranularity,
  busy,
}: {
  nodes: PlanSectionNodeView[]
  /** 分节计划里的课时（树上的课行据此显示时长与子节数）。 */
  lessons: PlanLessonView[]
  /** 素材覆盖率：目录覆盖了素材里多少条教学要点。 */
  coverage?: { coveredPoints: number; totalPoints: number; ratio: number } | null
  onRename: (nodeId: string, title: string) => void
  onRemove: (nodeId: string) => void
  /** 加节点：父节点为空 = 顶级篇，父为篇 = 章，父为章 = 课时。 */
  onAdd: (parentId: string | null, title: string) => void
  /** 移动节点：换父节点（newParentId）或在同级里调位置（position）。 */
  onMove: (nodeId: string, newParentId: string | null, position: number) => void
  /** 改课时的子节数。 */
  onSetGranularity: (lessonId: string, subLessonCount: number) => void
  busy: boolean
}) {
  const [closed, setClosed] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [addTitle, setAddTitle] = useState('')

  const counts = countOutlineLevels(nodes)
  const groups = useMemo(() => buildOutlineTree(nodes), [nodes])
  const lessonBySection = useMemo(() => {
    const map = new Map<string, PlanLessonView>()
    for (const lesson of lessons) {
      if (lesson.sectionId) map.set(lesson.sectionId, lesson)
    }
    return map
  }, [lessons])
  const childIds = useMemo(
    () => new Set(nodes.map((node) => node.parentId).filter((id): id is string => !!id)),
    [nodes],
  )
  const lessonCounts = useMemo(() => descendantLessonCounts(nodes), [nodes])

  function toggleClosed(id: string) {
    setClosed((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  function row(node: PlanSectionNodeView, level: 1 | 2 | 3) {
    const low = node.matchStatus === 'low_match'
    const sibling = siblingInfoOf(nodes, node.id)
    const lesson = level === 3 ? lessonBySection.get(node.id) : undefined
    const isClosed = closed.includes(node.id)
    const lessonCount = lessonCounts.get(node.id) ?? 0

    return (
      <div className={`olrow lv${level}${low ? ' err' : ''}`} key={node.id}>
        <span className="gh">
          {level < 3 ? (
            <button
              type="button"
              className="caret"
              aria-label={isClosed ? '展开' : '折叠'}
              aria-expanded={!isClosed}
              onClick={() => toggleClosed(node.id)}
            />
          ) : null}
          {level === 1 ? '篇' : level === 2 ? '章' : '课'}
        </span>

        <span className="ttl">
          {renaming === node.id ? (
            <span className="oe-inline">
              <input
                value={renameTitle}
                maxLength={200}
                aria-label="新标题"
                onChange={(e) => setRenameTitle(e.target.value)}
              />
              <button
                type="button"
                className="iconbtn"
                title="保存"
                aria-label="保存"
                disabled={busy || renameTitle.trim().length === 0}
                onClick={() => {
                  onRename(node.id, renameTitle.trim())
                  setRenaming(null)
                }}
              >
                <IconCheck />
              </button>
              <button
                type="button"
                className="iconbtn"
                title="取消"
                aria-label="取消"
                onClick={() => setRenaming(null)}
              >
                <IconClose />
              </button>
            </span>
          ) : (
            <b>{node.title}</b>
          )}
          {level === 3 ? (
            <>
              <span className="sc">
                {node.matchScore === null ? '无出处' : `${Math.round(node.matchScore * 100)}%`}
              </span>
              {lesson ? <span className="dur">{lesson.estimatedMinutes} 分钟</span> : null}
              {lesson ? (
                <span className="gran">
                  子节
                  <input
                    type="number"
                    min={1}
                    max={20}
                    defaultValue={lesson.subLessonCount}
                    disabled={busy}
                    aria-label={`${node.title} 的子节数`}
                    onBlur={(e) => {
                      const next = Number(e.target.value)
                      if (Number.isInteger(next) && next >= 1 && next <= 20) {
                        if (next !== lesson.subLessonCount) onSetGranularity(lesson.id, next)
                      } else {
                        e.target.value = String(lesson.subLessonCount)
                      }
                    }}
                  />
                </span>
              ) : null}
            </>
          ) : null}
          {level < 3 ? (
            <span className="cnt">{lessonCount} 课时</span>
          ) : null}
        </span>

        <span className="acts">
          {renaming !== node.id ? (
            <button
              type="button"
              className="btn link"
              title="改名"
              aria-label="改名"
              disabled={busy}
              onClick={() => {
                setRenaming(node.id)
                setRenameTitle(node.title)
              }}
            >
              ✎
            </button>
          ) : null}
          {sibling && sibling.count > 1 ? (
            <>
              <button
                type="button"
                className="btn link"
                title="上移"
                aria-label="上移"
                disabled={busy || sibling.index <= 0}
                onClick={() => onMove(node.id, sibling.parentId, sibling.index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn link"
                title="下移"
                aria-label="下移"
                disabled={busy || sibling.index >= sibling.count - 1}
                onClick={() => onMove(node.id, sibling.parentId, sibling.index + 1)}
              >
                ↓
              </button>
            </>
          ) : null}
          {level < 3 ? (
            <button
              type="button"
              className="btn link"
              title={level === 1 ? '在这一篇下加一章' : '在这一章下加一课时'}
              aria-label={level === 1 ? '加一章' : '加一课时'}
              disabled={busy}
              onClick={() => {
                setAdding(adding === node.id ? null : node.id)
                setAddTitle('')
              }}
            >
              ＋
            </button>
          ) : null}
          {!childIds.has(node.id) ? (
            <button
              type="button"
              className="btn link danger"
              title="删除"
              aria-label="删除"
              disabled={busy}
              onClick={() => onRemove(node.id)}
            >
              ✕
            </button>
          ) : null}
        </span>

        {level === 3 && node.evidence.length > 0 ? (
          <span className="src">
            {node.evidence.map((item) => (
              <span
                className="cite2"
                key={item.unitId}
                title={evidenceDetailLinesOf([item]).join('\n')}
              >
                {item.assetName} {formatClock(item.startMs)}–{formatClock(item.endMs)}
              </span>
            ))}
            <span className="pts">
              {node.evidence
                .flatMap((item) => item.points)
                .filter((point) => point.trim().length > 0)
                .slice(0, 3)
                .join(' · ')}
            </span>
          </span>
        ) : null}

        {adding === node.id ? (
          <span className="oe-inline addrow">
            <input
              value={addTitle}
              maxLength={200}
              placeholder={level === 1 ? '新章标题' : '新课时标题'}
              aria-label={level === 1 ? '新章标题' : '新课时标题'}
              onChange={(e) => setAddTitle(e.target.value)}
            />
            <button
              type="button"
              className="iconbtn"
              title="保存"
              aria-label="保存"
              disabled={busy || addTitle.trim().length === 0}
              onClick={() => {
                onAdd(node.id, addTitle.trim())
                setAdding(null)
                setAddTitle('')
              }}
            >
              <IconCheck />
            </button>
            <button
              type="button"
              className="iconbtn"
              title="取消"
              aria-label="取消"
              onClick={() => setAdding(null)}
            >
              <IconClose />
            </button>
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <div className="card" id="plan-outline">
      <div className="card-top">
        <b>课程大纲</b>
        <span className="meta">
          {counts.parts} 篇 · {counts.chapters} 章 · {counts.lessons} 课时
          {coverage
            ? ` · 素材覆盖 ${Math.round(coverage.ratio * 100)}%（${coverage.coveredPoints}/${coverage.totalPoints} 要点）`
            : ''}
        </span>
        <span className="meta">改名 / 挪位 / 删节都在这里做，改完立刻生效</span>
      </div>

      <div className="ol">
        {groups.map((group, groupIndex) => {
          const partClosed = group.part ? closed.includes(group.part.id) : false
          return (
            <div className="olgroup" key={group.part?.id ?? `group-${groupIndex}`}>
              {group.part ? row(group.part, 1) : null}
              {!partClosed
                ? group.chapters.map((chapter) => {
                    const chapterClosed = closed.includes(chapter.chapter.id)
                    return (
                      <div className="olchapter" key={chapter.chapter.id}>
                        {row(chapter.chapter, 2)}
                        {!chapterClosed
                          ? chapter.lessons.map((lesson) => row(lesson, 3))
                          : null}
                      </div>
                    )
                  })
                : null}
              {!partClosed
                ? group.loose.map((lesson) => row(lesson, 3))
                : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
