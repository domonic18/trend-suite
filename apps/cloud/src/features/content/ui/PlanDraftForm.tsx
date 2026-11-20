'use client'

import { useMemo, useState } from 'react'
import { parseOutlineText, normalizeOutlineText, type PlanMaterialView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import type { MaterialsReady } from './PlanPanel'
import { submitPlanInput } from '../api'

/**
 * 课程目标 + 人工目录表单（T7 显式触发起草）：
 * 目录按需求原话「可粘贴、可口述」——认不出的层级本地逐行标红，并可一键规整
 * （规整规则与服务端共用 @trend-suite/contracts，口径只有一份）。
 *
 * 迭代 8：可勾选参与本次规划的素材（多个视频做总体章节规划），
 * 并选「智能规划」（Agent 按素材要点重排目录）或「沿用人工目录骨架」。
 */
export function PlanDraftForm({
  courseId,
  initial,
  materials = null,
  courseMaterials = [],
  onSubmitted,
}: {
  courseId: string
  initial: { goal: string; outlineText: string } | null
  materials?: MaterialsReady | null
  /** 课程素材（勾选参与规划）：带理解产出的要点条数。 */
  courseMaterials?: PlanMaterialView[]
  onSubmitted: () => void
}) {
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [outlineText, setOutlineText] = useState(initial?.outlineText ?? '')
  const [mode, setMode] = useState<'smart' | 'follow_manual'>('follow_manual')
  // null = 未动过勾选（= 全部素材）；一旦勾选就是显式集合。
  const [picked, setPicked] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const issues = useMemo(
    () => (outlineText.trim().length === 0 ? [] : parseOutlineText(outlineText).issues),
    [outlineText],
  )

  const allIds = courseMaterials.map((item) => item.id)
  const selectedIds = picked ?? allIds
  const selectedPoints = courseMaterials
    .filter((item) => selectedIds.includes(item.id))
    .reduce((sum, item) => sum + item.pointCount, 0)
  const selectedMinutes = Math.round(
    courseMaterials
      .filter((item) => selectedIds.includes(item.id))
      .reduce((sum, item) => sum + (item.durationS ?? 0), 0) / 60,
  )
  const withoutUnits = courseMaterials.filter(
    (item) => selectedIds.includes(item.id) && item.unitCount === 0,
  )
  const noneSelected = picked !== null && picked.length === 0

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await submitPlanInput(courseId, {
        goal: goal.trim(),
        outlineText: outlineText.trim(),
        mode,
        assetIds: picked ?? undefined,
      })
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function normalize() {
    setOutlineText((prev) => normalizeOutlineText(prev))
  }

  function toggleMaterial(id: string) {
    setPicked((prev) => {
      const current = prev ?? allIds
      return current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    })
  }

  return (
    <div className="card plan-form">
      <div className="card-top">
        <b>提交课程目标与人工目录</b>
        <span className="meta">目录可粘贴、可口述</span>
      </div>
      <p className="form-note">
        Agent 将依据课程目标与已就绪素材起草方案：目录是骨架的下界，目录外的内容不会创建章节；
        未提到的目录章节会保留并标为「证据不足」，由你裁决。
        {materials ? `当前素材就绪 ${materials.ready}/${materials.total} 份。` : ''}
      </p>
      {error ? <div className="notice err">{error}</div> : null}
      <label className="field">
        <span>课程目标</span>
        <textarea
          rows={3}
          value={goal}
          maxLength={2000}
          placeholder="这门课要让学员学会什么？"
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>

      {courseMaterials.length > 0 ? (
        <div className="field">
          <span>参与本次规划的素材</span>
          <div className="mat-picker">
            {courseMaterials.map((item) => (
              <label className="mat-pick" key={item.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={() => toggleMaterial(item.id)}
                />
                <span className="mat-pick-name">{item.fileName}</span>
                <span className="meta">
                  {item.pointCount > 0 ? `${item.pointCount} 要点` : '未理解'}
                </span>
              </label>
            ))}
          </div>
          <p className="form-note">
            勾选多份素材即可做总体章节规划。不勾选 = 全部素材。
            已选 {selectedIds.length} 份 · {selectedPoints} 条要点 · 约 {selectedMinutes} 分钟素材。
          </p>
          {noneSelected ? <div className="notice warn">至少要选一份素材才能提交。</div> : null}
          {withoutUnits.length > 0 ? (
            <div className="notice warn">
              {withoutUnits.length} 份素材还没有理解结果（未理解 = 没有可规划的知识点），
              请到「上传与转写」页点「重跑理解」。
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="field">
        <span>规划方式</span>
        <div className="mode-picker">
          <label>
            <input
              type="radio"
              name="plan-mode"
              checked={mode === 'follow_manual'}
              onChange={() => setMode('follow_manual')}
            />
            沿用人工目录骨架
          </label>
          <label>
            <input
              type="radio"
              name="plan-mode"
              checked={mode === 'smart'}
              onChange={() => setMode('smart')}
            />
            智能重新规划目录
          </label>
        </div>
        <p className="form-note">
          {mode === 'smart'
            ? 'Agent 按所选素材的教学要点重新规划三级目录，目录规模由素材推导；你的原文会保留在下方。'
            : '以你粘贴的目录为骨架，Agent 只在其上做证据匹配与分节；目录留空时代拟一版。'}
        </p>
      </div>

      <label className="field">
        <span>
          人工目录（可选：留空则由 Agent 代拟）
          <button
            type="button"
            className="btn link"
            disabled={busy || outlineText.trim().length === 0}
            onClick={normalize}
          >
            一键规整
          </button>
        </span>
        <textarea
          rows={10}
          value={outlineText}
          maxLength={20000}
          placeholder={'第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义\n2. 级别的概念'}
          onChange={(e) => setOutlineText(e.target.value)}
        />
      </label>
      {outlineText.trim().length === 0 ? (
        <p className="form-note">
          目录可以留空：Agent 会依据课程目标与已就绪素材代拟一版目录先验，起草后可在此改写重提。
        </p>
      ) : null}
      {issues.length > 0 ? (
        <div className="notice err">
          <div>目录有 {issues.length} 行认不出层级，改格式或点「一键规整」后再提交：</div>
          <ul className="outline-issues">
            {issues.slice(0, 6).map((issue) => (
              <li key={issue.line}>
                第 {issue.line} 行：{issue.text.slice(0, 40)}
              </li>
            ))}
            {issues.length > 6 ? <li>…另有 {issues.length - 6} 行</li> : null}
          </ul>
        </div>
      ) : null}
      <div>
        <button
          type="button"
          className="btn primary"
          disabled={busy || goal.trim().length === 0 || issues.length > 0 || noneSelected}
          onClick={() => void submit()}
        >
          {busy ? '正在提交…' : '提交并开始起草'}
        </button>
      </div>
    </div>
  )
}
