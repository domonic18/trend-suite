'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MediaAssetView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { listAssets } from '@/features/pipeline/api'
import { planningReadyOf, understandingCountOf } from '@/features/pipeline/ui/processing'
import { createCourse, submitPlanInput } from '../api'
import { setDraftNotice } from './draftNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * 新建课程（Sasan 式极简，单屏两字段）：课程主题 + 选已有素材 → 生成大纲。
 * 主题同时是课程名来源（首行截断）与 Agent 的起草目标（全文）；目录不再
 * 手填——大纲由 Agent 代拟，生成后在方案页编辑、确认即进制作。
 * 没跑理解的素材置灰：没有教学要点可比，选了也规划不出东西。
 */
export function NewCoursePanel({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  /** 课程建好后回调（课程 id）。 */
  onCreated: (courseId: string) => void
}) {
  const router = useRouter()
  const [topic, setTopic] = useState('')
  const [assets, setAssets] = useState<MediaAssetView[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTopic('')
    setPicked([])
    setError(null)
    setLoadingAssets(true)
    void listAssets()
      .then(setAssets)
      .catch((err: unknown) =>
        setError(err instanceof ApiError ? err.message : '素材列表加载失败'),
      )
      .finally(() => setLoadingAssets(false))
  }, [])

  const pickedAssets = assets.filter((asset) => picked.includes(asset.id))
  // 勾了但没理解的素材：起草会被服务端挡下（素材未全部就绪），别让教师白等。
  const notReadyPicked = pickedAssets.filter((asset) => !planningReadyOf(asset))
  const canSubmit = topic.trim().length > 0 && notReadyPicked.length === 0

  function toggle(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  async function submit() {
    const goal = topic.trim()
    if (goal.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const course = await createCourse({
        // 课程名取主题首行（≤120）；改名走课程列表的改名入口
        title: (goal.split('\n')[0] ?? goal).slice(0, 120),
        goal,
        ...(picked.length > 0 ? { assetIds: picked } : {}),
      })
      try {
        await submitPlanInput(course.id, {
          goal,
          outlineText: '',
          mode: 'smart',
          assetIds: picked,
        })
      } catch (err) {
        // 课程已经建好（不回滚）：起草失败的原因带到方案页显示，别让教师再建一门课。
        setDraftNotice(err instanceof ApiError ? err.message : '起草未启动，请到方案页重提')
      }
      onCreated(course.id)
      router.push(`/workbench/courses/${course.id}/plan`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建课程失败')
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-[560px] py-6" aria-label="新建课程">
      <div className="rounded-xl border border-line bg-bg shadow-sm">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold">新建课程</h2>
        </div>

        <div className="px-5 pt-4 pb-1">
          {error ? (
            <Alert variant="destructive" className="mb-3.5">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="mb-3.5 grid gap-1.5">
            <Label htmlFor="nc-topic">课程主题</Label>
            <Textarea
              id="nc-topic"
              rows={3}
              maxLength={2000}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={'这门课讲什么、想让学员学会什么？\n如：用趋势线判断买卖点——从画法到实盘决策'}
              autoFocus
            />
          </div>

          <div className="mb-3.5 grid gap-1.5">
            <Label>选择素材（可跨课选用）</Label>
            {loadingAssets ? (
              <div className="empty">素材加载中…</div>
            ) : assets.length === 0 ? (
              <p className="text-[12.5px] leading-[1.7] text-mut">
                素材库还没有视频——先到「素材库」上传，之后建课就能在这里勾选。
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
                        {asset.durationS !== null ? `${Math.round(asset.durationS / 60)} 分钟 · ` : ''}
                        {ready ? `${points} 要点` : '需重跑理解'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
            {notReadyPicked.length > 0 ? (
              <Alert className="border-transparent bg-warn-soft text-warn">
                <AlertDescription>
                  {notReadyPicked.length} 份素材还没跑完理解，不能参与起草——先到素材库点
                  <b className="font-medium">「重新生成 · 视频理解」</b>。
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={!canSubmit || busy} onClick={() => void submit()}>
            {busy ? '正在创建…' : '生成大纲'}
          </Button>
        </div>
      </div>
    </section>
  )
}
