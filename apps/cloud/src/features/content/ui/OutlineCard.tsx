'use client'

import { useState } from 'react'
import type { PlanSectionNodeView } from '@trend-suite/contracts'

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

  const childIds = new Set(nodes.map((node) => node.parentId).filter((id): id is string => !!id))

  function togglePick(nodeId: string) {
    setPicked((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]))
  }

  return (
    <div className="card">
      <div className="card-top">
        <b>课程大纲</b>
        <span className="meta">{nodes.length} 章</span>
      </div>

      <div className="oe">
        {nodes.map((node, index) => {
          const low = node.matchStatus === 'low_match'
          return (
            <div className={`oe-row${low ? ' err' : ''}`} key={node.id}>
              <span className="gh">{String(index + 1).padStart(2, '0')}</span>
              <div className="ot">
                <b>{node.title}</b>
                <span className="meta">
                  {node.level} 级
                  {node.matchScore === null
                    ? ' · 无证据支撑'
                    : ` · 匹配度 ${Math.round(node.matchScore * 100)}%`}
                </span>
              </div>
              <span className={`st ${low ? 'st-err' : 'st-ok'}`}>
                <i />
                {low ? '待决定' : '通过'}
              </span>
              <div className="oa">
                <label className="oe-pick">
                  <input
                    type="checkbox"
                    checked={picked.includes(node.id)}
                    onChange={() => togglePick(node.id)}
                  />
                  选
                </label>
                {renaming === node.id ? (
                  <span className="oe-inline">
                    <input
                      value={renameTitle}
                      maxLength={200}
                      onChange={(e) => setRenameTitle(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn link"
                      disabled={busy || renameTitle.trim().length === 0}
                      onClick={() => {
                        onRename(node.id, renameTitle.trim())
                        setRenaming(null)
                      }}
                    >
                      存
                    </button>
                    <button type="button" className="btn link" onClick={() => setRenaming(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn link"
                    onClick={() => {
                      setRenaming(node.id)
                      setRenameTitle(node.title)
                    }}
                  >
                    改名
                  </button>
                )}
                {!childIds.has(node.id) ? (
                  <button
                    type="button"
                    className="btn link"
                    disabled={busy}
                    onClick={() => onRemove(node.id)}
                  >
                    删除
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
          disabled={busy || picked.length < 2 || mergeTitle.trim().length === 0}
          onClick={() => {
            onMerge(picked, mergeTitle.trim())
            setPicked([])
          }}
        >
          合并选中（{picked.length}）
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
