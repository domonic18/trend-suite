'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlanSectionNodeView } from '@trend-suite/contracts'
import { IconCheck, IconClose, IconPencil, IconTrash } from '@/features/lib/icons'
import { buildOutlineTree, countOutlineLevels, siblingInfoOf } from './outlineTree'

/** 骨架章节列表：匹配度 + 裁决动作（改名 / 删除 / 合并选）。教师主动加章不算未决项。 */
export function OutlineCard({
  nodes,
  coverage = null,
  onRename,
  onRemove,
  onMerge,
  onAdd,
  onMove,
  busy,
}: {
  nodes: PlanSectionNodeView[]
  /** 素材覆盖率：目录覆盖了素材里多少条教学要点。 */
  coverage?: { coveredPoints: number; totalPoints: number; ratio: number } | null
  onRename: (nodeId: string, title: string) => void
  onRemove: (nodeId: string) => void
  onMerge: (nodeIds: string[], title: string) => void
  onAdd: (parentId: string | null, title: string) => void
  /** 移动节点：换父节点（newParentId）或在同级里调位置（position）。 */
  onMove: (nodeId: string, newParentId: string | null, position: number) => void
  busy: boolean
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [mergeTitle, setMergeTitle] = useState('')
  const [addTitle, setAddTitle] = useState('')
  const [addParent, setAddParent] = useState<string>('')
  const allRef = useRef<HTMLInputElement>(null)

  const childIds = new Set(nodes.map((node) => node.parentId).filter((id): id is string => !!id))
  // 勾选集合按当前节点过滤：删章 / 改名后 nodes 会变，残留 id 不能带进合并。
  const liveIds = new Set(nodes.map((node) => node.id))
  const pickedLive = picked.filter((id) => liveIds.has(id))
  const allPicked = nodes.length > 0 && pickedLive.length === nodes.length
  const somePicked = pickedLive.length > 0 && pickedLive.length < nodes.length

  // 全选框三态：全选 / 部分 / 清空。
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = somePicked
  }, [somePicked])

  function togglePick(nodeId: string) {
    setPicked((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
  }

  function toggleAll() {
    setPicked(allPicked ? [] : nodes.map((node) => node.id))
  }

  const counts = countOutlineLevels(nodes)
  const groups = buildOutlineTree(nodes)
  const parts = nodes.filter((node) => node.level === 1)
  const chapters = nodes.filter((node) => node.level === 2)

  const row = (node: PlanSectionNodeView, level: 1 | 2 | 3) => {
    const low = node.matchStatus === 'low_match'
    const sibling = siblingInfoOf(nodes, node.id)
    // 可挂载的父节点：章挂篇、课时挂章——层级不乱。
    const candidates = level === 3 ? chapters : level === 2 ? parts : []
    const currentParent = node.parentId
      ? nodes.find((item) => item.id === node.parentId)
      : undefined
    return (
      <div className={`oe-row lv${level}${low ? ' err' : ''}`} key={node.id}>
        <label className="oe-pick" title={node.title}>
          <input
            type="checkbox"
            checked={picked.includes(node.id)}
            onChange={() => togglePick(node.id)}
            aria-label={`选择 ${node.title}`}
          />
        </label>
        <div className="ot">
          <b>{node.title}</b>
          <span className="meta">
            {level === 1 ? '篇' : level === 2 ? '章' : '课时'}
            {node.matchScore === null
              ? ' · 无证据支撑'
              : ` · 匹配度 ${Math.round(node.matchScore * 100)}%`}
            {node.sourceUnitIds.length > 0 ? ` · 出处 ${node.sourceUnitIds.length} 段` : ''}
            {low ? ' · 待裁决：改名 / 删除 / 与相近章合并' : ''}
          </span>
        </div>
        <span className={`st ${low ? 'st-err' : 'st-ok'}`}>
          <i />
          {low ? '待决定' : '通过'}
        </span>
        <div className="oa">
          {candidates.length > 0 ? (
            <select
              className="oe-move"
              value={node.parentId ?? ''}
              disabled={busy}
              aria-label={`移动 ${node.title}`}
              title="换到别的父章节下"
              onChange={(e) => {
                const value = e.target.value
                if (value === (node.parentId ?? '')) return
                onMove(node.id, value || null, 999)
              }}
            >
              {currentParent ? (
                <option value={currentParent.id}>当前：{currentParent.title.slice(0, 20)}</option>
              ) : (
                <option value="">（未归属）</option>
              )}
              {candidates
                .filter((item) => item.id !== node.parentId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title.slice(0, 20)}
                  </option>
                ))}
            </select>
          ) : null}
          {sibling && sibling.count > 1 ? (
            <>
              <button
                type="button"
                className="iconbtn"
                title="上移"
                aria-label="上移"
                disabled={busy || sibling.index <= 0}
                onClick={() => onMove(node.id, sibling.parentId, sibling.index - 1)}
              >
                上
              </button>
              <button
                type="button"
                className="iconbtn"
                title="下移"
                aria-label="下移"
                disabled={busy || sibling.index >= sibling.count - 1}
                onClick={() => onMove(node.id, sibling.parentId, sibling.index + 1)}
              >
                下
              </button>
            </>
          ) : null}
          {renaming === node.id ? (
            <span className="oe-inline">
              <input
                value={renameTitle}
                maxLength={200}
                onChange={(e) => setRenameTitle(e.target.value)}
                aria-label="新章节标题"
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
            <button
              type="button"
              className="iconbtn"
              title="改名"
              aria-label="改名"
              onClick={() => {
                setRenaming(node.id)
                setRenameTitle(node.title)
              }}
            >
              <IconPencil />
            </button>
          )}
          {!childIds.has(node.id) ? (
            <button
              type="button"
              className="iconbtn danger"
              title="删除"
              aria-label="删除"
              disabled={busy}
              onClick={() => onRemove(node.id)}
            >
              <IconTrash />
            </button>
          ) : null}
        </div>
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
        <label className="oe-pick-all" title="全选 / 取消全选">
          <input
            ref={allRef}
            type="checkbox"
            checked={allPicked}
            onChange={() => toggleAll()}
            aria-label="全选章节"
          />
          全选
        </label>
        {pickedLive.length > 0 ? <span className="meta">已选 {pickedLive.length} 章</span> : null}
      </div>

      <div className="oe">
        {groups.map((group, groupIndex) => (
          <div className="oe-group" key={group.part?.id ?? `group-${groupIndex}`}>
            {group.part ? row(group.part, 1) : null}
            {group.chapters.map((chapter) => (
              <div className="oe-chapter" key={chapter.chapter.id}>
                {row(chapter.chapter, 2)}
                {chapter.lessons.map((lesson) => row(lesson, 3))}
              </div>
            ))}
            {group.loose.map((lesson) => row(lesson, 3))}
          </div>
        ))}
      </div>

      <div className="oe-ops">
        <span>
          <input
            value={mergeTitle}
            placeholder="合并后标题"
            maxLength={200}
            onChange={(e) => setMergeTitle(e.target.value)}
          />
        </span>
        <button
          type="button"
          className="btn"
          disabled={busy || pickedLive.length < 2 || mergeTitle.trim().length === 0}
          onClick={() => {
            onMerge(pickedLive, mergeTitle.trim())
            setPicked([])
          }}
        >
          合并选中（{pickedLive.length}）
        </button>
        <span>
          <select value={addParent} onChange={(e) => setAddParent(e.target.value)}>
            <option value="">顶级（篇）</option>
            {nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title.slice(0, 40)}
              </option>
            ))}
          </select>
        </span>
        <input
          value={addTitle}
          placeholder="新章节标题"
          maxLength={200}
          onChange={(e) => setAddTitle(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || addTitle.trim().length === 0}
          onClick={() => {
            onAdd(addParent || null, addTitle.trim())
            setAddTitle('')
          }}
        >
          加一章
        </button>
      </div>
    </div>
  )
}
