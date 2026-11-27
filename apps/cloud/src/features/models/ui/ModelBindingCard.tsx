'use client'

import { memo } from 'react'
import { useEffect, useState } from 'react'
import { ApiError } from '@/features/lib/http'
import type { ModelEntryView, TaskBindingView } from '@trend-suite/contracts'
import { saveBinding } from '../api'
import { PURPOSE_LABELS } from '../providers'

import { ModelTestBadge } from './ModelTestBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * 任务槽位绑定卡（对齐家族 aitech-hub BindingCards/RoleCard 形态）：
 * 一槽一卡，主备下拉纵向对齐；「测试主模型」复用条目测试通道，
 * 结果随条目落库并在卡内徽章内联展示；保存/测试反馈在卡内，不动页面级横幅。
 */
export const ModelBindingCard = memo(function ModelBindingCard(props: {
  binding: TaskBindingView
  models: ModelEntryView[]
  canWrite: boolean
  testingIds: ReadonlySet<string>
  onTest: (modelId: string) => Promise<void>
  onChanged: () => Promise<void>
}) {
  const usable = props.models.filter(
    (m) => m.purposes.includes(props.binding.purpose) && m.status === 'active',
  )
  const [primary, setPrimary] = useState(props.binding.primaryModelId ?? '')
  const [backup, setBackup] = useState(props.binding.backupModelId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setPrimary(props.binding.primaryModelId ?? '')
    setBackup(props.binding.backupModelId ?? '')
  }, [props.binding.primaryModelId, props.binding.backupModelId])

  async function save() {
    if (!primary) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await saveBinding({
        task: props.binding.task,
        primaryModelId: primary,
        backupModelId: backup || null,
      })
      setSaved(true)
      await props.onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '绑定保存失败')
    } finally {
      setBusy(false)
    }
  }

  const primaryEntry = props.models.find((m) => m.id === primary) ?? null
  const testing = primaryEntry !== null && props.testingIds.has(primaryEntry.id)

  return (
    <div
      className="rounded-xl border border-line bg-bg px-4 py-3.5"
      role="group"
      aria-label={`${props.binding.taskLabel}绑定`}
    >
      <div className="flex items-center gap-2 text-sm">
        <b>{props.binding.taskLabel}</b>
        <Badge>{PURPOSE_LABELS[props.binding.purpose]}</Badge>
      </div>
      <div className="mt-1 mb-3 text-xs text-mut">{props.binding.task}</div>
      <div className="mb-2.5 grid gap-1.5">
        <Label className="text-[12.5px] text-mut">主模型</Label>
        <Select
          value={primary}
          disabled={!props.canWrite}
          onValueChange={(v) => {
            setPrimary(v)
            setSaved(false)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {usable.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}（{m.model}）
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mb-2.5 grid gap-1.5">
        <Label className="text-[12.5px] text-mut">备用模型</Label>
        <Select
          value={backup}
          disabled={!props.canWrite}
          onValueChange={(v) => {
            setBackup(v)
            setSaved(false)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="无备用" />
          </SelectTrigger>
          <SelectContent>
            {usable
              .filter((m) => m.id !== primary)
              .map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}（{m.model}）
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5 text-[12.5px] text-mut">
        <span>主模型连通</span>
        {primaryEntry ? (
          <ModelTestBadge
            testing={testing}
            result={primaryEntry.lastTestResult}
            latencyMs={primaryEntry.lastTestLatencyMs}
            error={primaryEntry.lastTestError}
            testedAt={primaryEntry.lastTestedAt}
          />
        ) : (
          <span>未选择主模型</span>
        )}
      </div>
      {error ? <p className="mt-1.5 text-[12.5px] text-destructive">{error}</p> : null}
      {saved && !error ? <p className="mt-1.5 text-[12.5px] text-mut">已保存，下一次任务即生效</p> : null}
      {props.canWrite ? (
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!primary || testing}
            onClick={() => void props.onTest(primary)}
          >
            {testing ? '测试中…' : '测试主模型'}
          </Button>
          <Button disabled={busy || !primary} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </Button>
        </div>
      ) : null}
    </div>
  )
})
