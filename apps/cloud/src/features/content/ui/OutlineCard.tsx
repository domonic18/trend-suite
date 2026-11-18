'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlanSectionNodeView } from '@trend-suite/contracts'

/** 行内裁决动作用图标（悬停出 title 说明）：改名 / 删除 / 存 / 取消。 */
function IconPencil() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M11.2 1.9 14.1 4.8 5.3 13.6 1.9 14.1l.5-3.4zM9.7 3.4l2.9 2.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M2.8 4.2h10.4M6.3 4.2V2.6h3.4v1.6M4.3 4.2l.6 9a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.6-9M6.7 6.6v4.7M9.3 6.6v4.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M3.2 8.4 6.4 11.6 12.8 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconClose() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M4.4 4.4 11.6 11.6M11.6 4.4 4.4 11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 骨架章节列表：匹配度 + 裁决动作（改名 / 删除 / 合并选）。教师主动加章不算未决项。 */
export function OutlineCard({
  nodes,
  onRename,
  onRemove,
  onMerge,
  onAdd,
  busy,
}: {
  nodes: PlanSectionNodeView[]
  onRename: (nodeId: string, title: string) => void
  onRemove: (nodeId: string) => void
  onMerge: (nodeIds: string[], title: string) => void
  onAdd: (parentId: string | null, title: string) => void
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

  // 全选框三态：全选 / 部分 / 未选。
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = somePicked
  }, [somePicked])

  function togglePick(nodeId: string) {
    setPicked((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
  }

  function toggleAll() {
    setPicked(allPicked ? [] : nodes.map((node) => node.id))
  }

  return (
    <div className="card" id="plan-outline">
      <div className="card-top">
        <b>课程大纲</b>
        <span className="meta">{nodes.length} 章</span>
        <label className="oe-pick-all" title="全选 / 取消全选">
          <input
            ref={allRef}
            type="checkbox"
            checked={allPicked}
            onChange={toggleAll}
            aria-label="全选章节"
          />
          全选
        </label>
        {pickedLive.length > 0 ? <span className="meta">已选 {pickedLive.length} 章</span> : null}
      </div>

      <div className="oe">
        {nodes.map((node, index) => {
          const low = node.matchStatus === 'low_match'
          return (
            <div className={`oe-row${low ? ' err' : ''}`} key={node.id}>
              <label className="oe-pick" title={node.title}>
                <input
                  type="checkbox"
                  checked={picked.includes(node.id)}
                  onChange={() => togglePick(node.id)}
                  aria-label={`选择 ${node.title}`}
                />
              </label>
              <span className="gh">{String(index + 1).padStart(2, '0')}</span>
              <div className="ot">
                <b>{node.title}</b>
                <span className="meta">
                  {node.level} 级
                  {node.matchScore === null
                    ? ' · 无证据支撑'
                    : ` · 匹配度 ${Math.round(node.matchScore * 100)}%`}
                  {low ? ' · 待裁决：改名 / 删除 / 与相近章合并' : ''}
                </span>
              </div>
              <span className={`st ${low ? 'st-err' : 'st-ok'}`}>
                <i />
                {low ? '待决定' : '通过'}
              </span>
              <div className="oa">
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
        })}
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
