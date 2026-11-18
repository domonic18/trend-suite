'use client'

import { useState } from 'react'
import { ApiError } from '@/features/lib/http'
import type { MaterialsReady } from './PlanPanel'
import { submitPlanInput } from '../api'

/** 课程目标 + 人工目录表单（T7 显式触发起草）：说明 Agent 依据什么起草，草案生成前可反复改。 */
export function PlanDraftForm({
  courseId,
  initial,
  materials = null,
  onSubmitted,
}: {
  courseId: string
  initial: { goal: string; outlineText: string } | null
  materials?: MaterialsReady | null
  onSubmitted: () => void
}) {
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [outlineText, setOutlineText] = useState(initial?.outlineText ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await submitPlanInput(courseId, { goal: goal.trim(), outlineText: outlineText.trim() })
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card plan-form">
      <div className="card-top">
        <b>提交课程目标与人工目录</b>
        <span className="meta">目录用「第X篇 / 第X章 / 1.」三级编号</span>
      </div>
      <p className="form-note">
        Agent 将依据你的目录先验与已就绪素材起草方案：目录是骨架的下界，目录外的内容不会创建章节；
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
      <label className="field">
        <span>人工目录（每行一节）</span>
        <textarea
          rows={10}
          value={outlineText}
          maxLength={20000}
          placeholder={'第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义\n2. 级别的概念'}
          onChange={(e) => setOutlineText(e.target.value)}
        />
      </label>
      <div>
        <button
          type="button"
          className="btn primary"
          disabled={busy || goal.trim().length === 0 || outlineText.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? '正在提交…' : '提交并开始起草'}
        </button>
      </div>
    </div>
  )
}
