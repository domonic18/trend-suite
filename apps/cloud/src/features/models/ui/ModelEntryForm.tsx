'use client'

import { memo } from 'react'
import {
  MODEL_PROVIDERS,
  OTHER_PROVIDER,
  findProviderPreset,
  isPresetBaseUrl,
  providerBaseUrl,
  providerProtocols,
} from '../providers'
import type { ModelProtocol, ModelPurpose } from '@trend-suite/contracts'
import { allowedProtocols, availableProtocols, PURPOSE_LABELS, PROTOCOL_LABELS } from './OpsModelsPanel'
import type { EntryForm } from './OpsModelsPanel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export const ModelEntryForm = memo(function ModelEntryForm(props: {
  form: EntryForm
  busy: boolean
  setForm: (next: EntryForm) => void
  onSubmit: (event: React.FormEvent) => void
  onCancel: () => void
}) {
  const { form } = props
  const preset = findProviderPreset(form.provider)

  /** 协议变了，地址跟着换成该厂商该协议的端点；手填地址不动。 */
  function syncProtocol(next: EntryForm, protocol: ModelProtocol): EntryForm {
    const picked = findProviderPreset(next.provider)
    const endpoint = picked ? providerBaseUrl(picked, protocol) : null
    const baseUrlUsable = next.baseUrl === '' || isPresetBaseUrl(next.baseUrl)
    return {
      ...next,
      protocol,
      baseUrl: baseUrlUsable && endpoint ? endpoint : next.baseUrl,
    }
  }

  /** 用途 toggle：至少一项；协议随所选用途交集收缩（当前协议不在交集内则重置为交集第一个）。 */
  function togglePurpose(purpose: ModelPurpose) {
    const next = form.purposes.includes(purpose)
      ? form.purposes.filter((p) => p !== purpose)
      : [...form.purposes, purpose]
    if (next.length === 0) return
    const allowed = allowedProtocols(next)
    const protocol = allowed.includes(form.protocol) ? form.protocol : (allowed[0] ?? 'openai')
    props.setForm(syncProtocol({ ...form, purposes: next }, protocol))
  }

  /** 选厂商：填协议（厂商支持 ∩ 用途允许）与该协议对应的端点地址。 */
  function pickProvider(provider: string) {
    if (provider === '') {
      props.setForm({ ...form, provider: '', custom: false })
      return
    }
    if (provider === OTHER_PROVIDER) {
      // 自定义供应商：清空预置，名称由用户在「供应商名称」里手填
      props.setForm({ ...form, provider: '', custom: true })
      return
    }
    const picked = findProviderPreset(provider)
    if (!picked) {
      props.setForm({ ...form, provider, custom: false })
      return
    }
    const usable = availableProtocols(form.purposes, picked)
    const protocol = usable.includes(picked.protocol) ? picked.protocol : (usable[0] ?? form.protocol)
    const endpoint = providerBaseUrl(picked, protocol)
    const baseUrlUsable = form.baseUrl === '' || isPresetBaseUrl(form.baseUrl)
    props.setForm({
      ...form,
      provider: picked.label,
      custom: false,
      protocol,
      baseUrl: baseUrlUsable && endpoint ? endpoint : form.baseUrl,
    })
  }

  /** 切协议：地址跟着换成该厂商该协议的端点（手填地址不动）。 */
  function pickProtocol(protocol: ModelProtocol) {
    props.setForm(syncProtocol(form, protocol))
  }

  return (
    <form
      className="mb-3.5 rounded-xl border border-line bg-soft px-4 py-3.5"
      onSubmit={props.onSubmit}
    >
      <h4 className="mb-3 text-[14.5px] font-bold">{form.id ? '编辑模型条目' : '新增模型条目'}</h4>
      <div className="grid gap-x-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <div className="mb-3.5 grid gap-1.5">
          <Label>名称</Label>
          <Input
            value={form.name}
            onChange={(e) => props.setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>用途（可多选）</Label>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PURPOSE_LABELS) as ModelPurpose[]).map((purpose) => (
              <button
                key={purpose}
                type="button"
                aria-pressed={form.purposes.includes(purpose)}
                className={
                  form.purposes.includes(purpose)
                    ? 'cursor-pointer rounded-[6px] border border-primary bg-pri-soft px-3 py-[5px] text-[12.5px] font-semibold text-primary'
                    : 'cursor-pointer rounded-[6px] border border-line bg-none px-3 py-[5px] text-[12.5px] text-mut hover:text-ink'
                }
                onClick={() => togglePurpose(purpose)}
              >
                {PURPOSE_LABELS[purpose]}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>供应商</Label>
          <Select
            value={form.custom ? OTHER_PROVIDER : preset ? preset.value : ''}
            onValueChange={pickProvider}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
              <SelectItem value={OTHER_PROVIDER}>其他（手动填写）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {form.custom ? (
          <div className="mb-3.5 grid gap-1.5">
            <Label>供应商名称</Label>
            <Input
              value={form.provider}
              onChange={(e) => props.setForm({ ...form, provider: e.target.value })}
              required
            />
          </div>
        ) : null}
        <div className="mb-3.5 grid gap-1.5">
          <Label>调用协议</Label>
          <Select value={form.protocol} onValueChange={(v) => pickProtocol(v as ModelProtocol)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableProtocols(form.purposes, preset).map((protocol) => (
                <SelectItem key={protocol} value={protocol}>
                  {PROTOCOL_LABELS[protocol]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>模型名</Label>
          <Input
            value={form.model}
            list="provider-model-examples"
            onChange={(e) => props.setForm({ ...form, model: e.target.value })}
            required
          />
          <datalist id="provider-model-examples">
            {(findProviderPreset(form.provider)?.modelExamples ?? []).map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>Base URL</Label>
          <Input
            value={form.baseUrl}
            placeholder="https://api.example.com"
            onChange={(e) => props.setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>密钥</Label>
          <Input
            type="password"
            value={form.apiKey}
            placeholder={form.id ? '留空即保留原密钥' : ''}
            onChange={(e) => props.setForm({ ...form, apiKey: e.target.value })}
          />
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>默认条目</Label>
          <Checkbox
            checked={form.isDefault}
            onCheckedChange={(v) => props.setForm({ ...form, isDefault: v === true })}
          />
        </div>
      </div>
      <div className="mfoot">
        <Button type="submit" disabled={props.busy}>
          保存
        </Button>
        <Button type="button" variant="outline" onClick={props.onCancel}>
          取消
        </Button>
      </div>
    </form>
  )
})
