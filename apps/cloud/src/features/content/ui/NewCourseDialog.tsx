'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseOutlineText, type MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '@/features/pipeline/api'
import { planningReadyOf, understandingCountOf } from '@/features/pipeline/ui/processing'
import { createCourse, submitPlanInput } from '../api'
import { setDraftNotice } from './draftNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * 新建课程弹窗（教师端主流程第 1 步）：
 * 课程名 + 课程目标 + 选素材 + 目录先验（可选），一键「创建课程并生成大纲」。
 *
 * 素材来自素材库全局视角（跨课程）——一份素材可以被多门课选用，归属课程不变。
 * 没跑理解的素材置灰：没有教学要点可比，选了也规划不出东西。
 */
export function NewCourseDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** 课程建好后回调（课程 id）。 */
  onCreated: (courseId: string) => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [outlineText, setOutlineText] = useState('')
  const [showOutline, setShowOutline] = useState(false)
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setGoal('')
    setOutlineText('')
    setShowOutline(false)
    setPicked([])
    setError(null)
    setLoadingAssets(true)
    void listAssets()
      .then(setAssets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : '素材列表加载失败'),
      )
      .finally(() => setLoadingAssets(false))
  }, [open])

  const issues = useMemo(
    () => (outlineText.trim().length === 0 ? [] : parseOutlineText(outlineText).issues),
    [outlineText],
  )

  const pickedAssets = assets.filter((asset) => picked.includes(asset.id))
  // 勾了但没理解的素材：起草会被服务端挡下（素材未全部就绪），别让教师白等。
  const notReadyPicked = pickedAssets.filter((asset) => !planningReadyOf(asset))
  const readyCount = pickedAssets.filter((asset) => planningReadyOf(asset)).length
  const canDraft =
    goal.trim().length > 0 && picked.length > 0 && notReadyPicked.length === 0

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  async function submit(alsoDraft: boolean) {
    if (title.trim().length === 0) {
      setError('课程名称必填')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const course = await createCourse({
        title: title.trim(),
        ...(goal.trim() ? { goal: goal.trim() } : {}),
        ...(outlineText.trim() ? { outlineText: outlineText.trim() } : {}),
        ...(picked.length > 0 ? { assetIds: picked } : {}),
      })
      if (!alsoDraft) {
        onClose()
        onCreated(course.id)
        return
      }
      try {
        await submitPlanInput(course.id, {
          goal: goal.trim(),
          outlineText: outlineText.trim(),
          mode: outlineText.trim().length > 0 ? 'follow_manual' : 'smart',
          assetIds: picked,
        })
      } catch (err) {
        // 课程已经建好（不回滚）：起草失败的原因带到方案页显示，别让教师再建一门课。
        setDraftNotice(err instanceof ApiError ? err.message : '起草未启动，请到方案页重提')
      }
      onClose()
      onCreated(course.id)
      router.push(`/workbench/courses/${course.id}/plan`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建课程失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建课程</DialogTitle>
          <DialogDescription className="sr-only">
            课程名、目标、素材与可选的目录先验
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pt-3 pb-1">
          {error ? (
            <Alert variant="destructive" className="mb-3.5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mb-3.5 grid gap-1.5">
            <Label htmlFor="nc-title">课程名称</Label>
            <Input
              id="nc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="如：总论卷"
            />
          </div>

          <div className="mb-3.5 grid gap-1.5">
            <Label htmlFor="nc-goal">课程目标</Label>
            <Textarea
              id="nc-goal"
              rows={2}
              maxLength={2000}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="这门课要让学员学会什么？"
            />
            <p className="text-[12.5px] leading-[1.7] text-mut">
              目标会交给 Agent——它据此梳理素材、规划章节。填了目标才能
              <b className="font-medium text-ink">「创建并生成大纲」</b>。
            </p>
          </div>

          <div className="mb-3.5 grid gap-1.5">
            <Label>选择素材（可跨课选用）</Label>
            {loadingAssets ? (
              <div className="empty">素材加载中…</div>
            ) : assets.length === 0 ? (
              <p className="text-[12.5px] leading-[1.7] text-mut">
                素材库里还没有视频。先到<b className="font-medium text-ink">「素材库」</b>上传——上传时选好归属课程，之后建课就能在这里勾选。
              </p>
            ) : (
              <div className="mat-picker">
                {assets.map((asset) => {
                  const ready = planningReadyOf(asset)
                  const points = understandingCountOf(asset)
                  return (
                    <label
                      className={`mat-pick${ready ? '' : ' off'}`}
                      key={asset.id}
                      title={ready ? '' : '还没跑完理解——先到素材库重跑理解'}
                    >
                      <Checkbox
                        checked={picked.includes(asset.id)}
                        disabled={!ready}
                        onCheckedChange={() => toggle(asset.id)}
                      />
                      <span className="mat-pick-name">{asset.fileName}</span>
                      <span className="text-xs text-mut">
                        {asset.courseTitle ? `${asset.courseTitle} · ` : ''}
                        {asset.durationS !== null ? `${Math.round(asset.durationS / 60)} 分钟 · ` : ''}
                        {ready ? `${points} 要点` : points > 0 ? '理解未完成' : '需重跑理解'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            <p className="text-[12.5px] leading-[1.7] text-mut">
              勾选的素材参与本次大纲生成；素材归属哪门课不变，一份素材可以被多门课选用。
              已选 <b className="font-medium text-ink">{picked.length}</b> 份，其中
              <b className="font-medium text-ink"> {readyCount} </b>份可直接规划。
            </p>
            {notReadyPicked.length > 0 ? (
              <Alert className="border-transparent bg-warn-soft text-warn">
                <AlertDescription>
                  {notReadyPicked.length} 份素材还没跑完理解，不能参与起草——先到素材库点
                  <b className="font-medium">「重新生成 · 视频理解」</b>。
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <details
            className="mb-3.5 grid gap-1.5"
            open={showOutline}
            onToggle={(e) => setShowOutline(e.currentTarget.open)}
          >
            <summary className="cursor-pointer text-[13px] text-mut">目录先验（可选）</summary>
            <Textarea
              rows={5}
              maxLength={20000}
              value={outlineText}
              placeholder={'第一篇 总论\n第一章 什么是趋势\n1. 趋势的定义'}
              onChange={(e) => setOutlineText(e.target.value)}
            />
            {issues.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  有 {issues.length} 行认不出层级，改格式后再生成大纲：
                  <ul className="mt-1 list-disc pl-4 text-[12px] leading-[1.7]">
                    {issues.slice(0, 4).map((issue) => (
                      <li key={issue.line}>
                        第 {issue.line} 行：{issue.text.slice(0, 30)}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <p className="text-[12.5px] leading-[1.7] text-mut">
              有现成的三级目录就粘进来——<b className="font-medium text-ink">目录是你说了算</b>，Agent 只在它上面挂出处。留空则由 Agent 代拟。
            </p>
          </details>
        </div>

        <DialogFooter className="gap-2 border-t border-line px-4 py-3 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void submit(false)}>
            {busy ? '创建中…' : '只建课程'}
          </Button>
          <Button
            disabled={busy || !canDraft || issues.length > 0}
            title={
              goal.trim().length === 0
                ? '先填课程目标'
                : picked.length === 0
                  ? '先勾选素材'
                  : notReadyPicked.length > 0
                    ? '有素材还没跑完理解'
                    : undefined
            }
            onClick={() => void submit(true)}
          >
            {busy ? '创建中…' : '创建课程并生成大纲'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
