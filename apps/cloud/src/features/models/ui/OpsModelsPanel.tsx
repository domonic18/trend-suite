'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  AsrChannelView,
  ModelEntryView,
  ModelPurpose,
  ModelProtocol,
  TaskBindingView,
} from '@trend-suite/contracts'
import { Trash2 } from 'lucide-react'
import { ApiError } from '@/features/lib/http'
import {
  MODEL_PROVIDERS,
  OTHER_PROVIDER,
  findProviderPreset,
  isPresetBaseUrl,
  providerBaseUrl,
  providerProtocols,
} from '../providers'
import {
  createModel,
  deleteModel,
  getAsrChannel,
  listBindings,
  listModels,
  saveBinding,
  testModel,
  updateModel,
} from '../api'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Tab = 'entries' | 'bindings' | 'asr'

const TAB_LABELS: Record<Tab, string> = {
  entries: '模型条目',
  bindings: '任务模型',
  asr: 'ASR 渠道',
}

const PURPOSE_LABELS: Record<ModelPurpose, string> = {
  llm: '内容生成',
  vlm: '视觉理解',
  asr: '语音转写',
  embedding: '向量嵌入',
  image: '图像生成',
}

const PROTOCOL_LABELS: Record<ModelProtocol, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
  minimax: 'MiniMax 专有',
}

/** 用途允许的协议（与服务端一致，服务端还会再挡一次）。 */
const PROTOCOLS_BY_PURPOSE: Record<ModelPurpose, ModelProtocol[]> = {
  llm: ['openai', 'anthropic'],
  vlm: ['openai', 'anthropic'],
  asr: ['minimax', 'openai'],
  embedding: ['openai'],
  image: ['openai'],
}

/** 多用途条目的协议交集：用途全允许才可选。 */
function allowedProtocols(purposes: ModelPurpose[]): ModelProtocol[] {
  const sets = purposes.map((p) => PROTOCOLS_BY_PURPOSE[p])
  return (Object.keys(PROTOCOL_LABELS) as ModelProtocol[]).filter((protocol) =>
    sets.every((list) => list.includes(protocol)),
  )
}

/** 可选协议 = 用途允许集 ∩ 厂商支持集；选了预置厂商后不再列出该厂商没有的协议。 */
function availableProtocols(
  purposes: ModelPurpose[],
  preset: ReturnType<typeof findProviderPreset>,
): ModelProtocol[] {
  const allowed = allowedProtocols(purposes)
  if (!preset) return allowed
  const supported = providerProtocols(preset)
  return allowed.filter((protocol) => supported.includes(protocol))
}

type EntryForm = {
  id: string | null
  name: string
  purposes: ModelPurpose[]
  provider: string
  /** 自定义供应商（「其他」手填名称）：provider 存用户输入，select 停在「其他」。 */
  custom: boolean
  protocol: ModelProtocol
  model: string
  baseUrl: string
  apiKey: string
  isDefault: boolean
}

const EMPTY_FORM: EntryForm = {
  id: null,
  name: '',
  purposes: ['llm'],
  provider: '',
  custom: false,
  protocol: 'openai',
  model: '',
  baseUrl: '',
  apiKey: '',
  isDefault: false,
}

export function OpsModelsPanel({ canWrite }: { canWrite: boolean }) {
  const [tab, setTab] = useState<Tab>('entries')
  const [models, setModels] = useState<ModelEntryView[]>([])
  const [bindings, setBindings] = useState<TaskBindingView[]>([])
  const [channel, setChannel] = useState<AsrChannelView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<EntryForm | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在连通性测试的条目 id：行内按钮变「测试中…」，列表徽章同步。 */
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(new Set())
  /** 待确认删除的条目（AlertDialog 受控；确认后才发起删除）。 */
  const [pendingDelete, setPendingDelete] = useState<ModelEntryView | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [entries, slots, asr] = await Promise.all([
        listModels(),
        listBindings(),
        getAsrChannel(),
      ])
      setModels(entries)
      setBindings(slots)
      setChannel(asr)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '模型配置加载失败')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function edit(entry: ModelEntryView) {
    setNotice(null)
    setForm({
      id: entry.id,
      name: entry.name,
      purposes: entry.purposes,
      provider: entry.provider,
      custom: entry.provider !== '' && !findProviderPreset(entry.provider),
      protocol: entry.protocol,
      model: entry.model,
      baseUrl: entry.baseUrl ?? '',
      apiKey: '',
      isDefault: entry.isDefault,
    })
  }

  /** ASR 渠道的编辑目标：默认 asr 条目优先，其次任意含 asr 用途的条目。 */
  function findAsrEntry(): ModelEntryView | null {
    return (
      models.find((m) => m.purposes.includes('asr') && m.isDefault) ??
      models.find((m) => m.purposes.includes('asr')) ??
      null
    )
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (form.id) {
        await updateModel(form.id, {
          name: form.name,
          purposes: form.purposes,
          provider: form.provider,
          protocol: form.protocol,
          model: form.model,
          baseUrl: form.baseUrl || undefined,
          apiKey: form.apiKey,
          isDefault: form.isDefault,
        })
        setNotice('已保存')
      } else {
        await createModel({
          name: form.name,
          purposes: form.purposes,
          provider: form.provider,
          protocol: form.protocol,
          model: form.model,
          baseUrl: form.baseUrl || undefined,
          apiKey: form.apiKey || undefined,
          isDefault: form.isDefault,
        })
        setNotice('已新增')
      }
      setForm(null)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /**
   * 连通性测试不走顶部横幅（横幅插入/消失会把整页内容往下推）：
   * 结果随条目落库，「上次测试」徽章即反馈；仅请求本身异常（未配置密钥等）才横幅报错。
   */
  async function runTest(id: string) {
    setError(null)
    setTestingIds((prev) => new Set(prev).add(id))
    try {
      await testModel(id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '测试失败')
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
    await refresh()
  }

  async function remove(id: string) {
    setError(null)
    try {
      await deleteModel(id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <section>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab)
          // 横幅是上一个 tab 的操作反馈，切走即清（避免挂在下一个 tab 顶部撑动布局）
          setError(null)
          setNotice(null)
        }}
      >
        <TabsList className="mb-[18px] h-auto w-full justify-start gap-1 rounded-none border-b border-line bg-transparent p-0">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <TabsTrigger
              key={key}
              value={key}
              className="rounded-none border-b-2 border-transparent px-[18px] py-2.5 text-sm text-mut data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:font-semibold data-[state=active]:shadow-none"
            >
              {TAB_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="entries">
          <div className="card">
            {canWrite ? (
              <div className="mfoot mt-0 mb-2.5">
                <Button onClick={() => setForm({ ...EMPTY_FORM })}>新增模型</Button>
              </div>
            ) : (
              <p className="meta">当前角色只读：只有管理员可以维护模型配置。</p>
            )}

            {form ? (
              <EntryFormCard
                form={form}
                busy={busy}
                setForm={setForm}
                onSubmit={submit}
                onCancel={() => setForm(null)}
              />
            ) : null}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>用途</TableHead>
                  <TableHead>协议</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>密钥</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>上次测试</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {models.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <b>{entry.name}</b>
                      {entry.isDefault ? <Badge className="ml-1.5">默认</Badge> : null}
                    </TableCell>
                    <TableCell>{entry.purposes.map((p) => PURPOSE_LABELS[p]).join(' + ')}</TableCell>
                    <TableCell>{PROTOCOL_LABELS[entry.protocol]}</TableCell>
                    <TableCell>{entry.model}</TableCell>
                    <TableCell>{entry.apiKeyMasked ?? '未配置'}</TableCell>
                    <TableCell>{entry.status === 'active' ? '启用' : entry.status === 'cooling' ? '冷却' : '禁用'}</TableCell>
                    <TableCell>
                      <TestBadge
                        testing={testingIds.has(entry.id)}
                        result={entry.lastTestResult}
                        latencyMs={entry.lastTestLatencyMs}
                        error={entry.lastTestError}
                        testedAt={entry.lastTestedAt}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {canWrite ? (
                        <>
                          <Button
                            variant="link"
                            size="sm"
                            disabled={testingIds.has(entry.id)}
                            onClick={() => void runTest(entry.id)}
                          >
                            {testingIds.has(entry.id) ? '测试中…' : '测试'}
                          </Button>
                          <Button variant="link" size="sm" onClick={() => edit(entry)}>
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="删除条目"
                            onClick={() => setPendingDelete(entry)}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="meta">连通性测试会真实调用一次（需计费）。密钥加密存储，列表只回掩码。</p>
          </div>
        </TabsContent>

        <TabsContent value="bindings">
          <div className="card">
            <p className="meta">
              每槽位绑定主模型（必填）与可选备用；备用不可与主模型相同。下拉只列出与槽位用途匹配且启用的条目；「测试主模型」对当前选中的主模型发起连通性测试（真实调用一次，需计费）。
            </p>
            <div className="mt-3.5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
              {bindings.map((binding) => (
                <BindingCard
                  key={binding.task}
                  binding={binding}
                  models={models}
                  canWrite={canWrite}
                  testingIds={testingIds}
                  onTest={runTest}
                  onChanged={refresh}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="asr">
          <div className="card">
            <p className="meta">素材入库即转写：partial 段落实时可读。保存即刻生效。</p>
            {form && form.purposes.includes('asr') ? (
              <EntryFormCard
                form={form}
                busy={busy}
                setForm={setForm}
                onSubmit={submit}
                onCancel={() => setForm(null)}
              />
            ) : null}
            {channel ? (
              <Table>
                <TableBody>
                  <TableRow>
                    <TableHead>供应商</TableHead>
                    <TableCell>{channel.provider || '未配置'}</TableCell>
                    <TableHead>调用协议</TableHead>
                    <TableCell>{PROTOCOL_LABELS[channel.protocol]}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>模型</TableHead>
                    <TableCell>{channel.model || '未配置'}</TableCell>
                    <TableHead>Base URL</TableHead>
                    <TableCell>{channel.baseUrl || '未配置'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>API Key</TableHead>
                    <TableCell>{channel.apiKeyMasked ?? '未配置'}</TableCell>
                    <TableHead>状态</TableHead>
                    <TableCell>{channel.status === 'active' ? '启用' : channel.status === 'cooling' ? '冷却' : '禁用'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>单条音频时长上限</TableHead>
                    <TableCell>{channel.maxAudioSeconds} 秒</TableCell>
                    <TableHead>热词</TableHead>
                    <TableCell>
                      {channel.hotwordSupported ? `${channel.hotwordCount} 个` : '该协议不支持热词注入'}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableHead>最后测试</TableHead>
                    <TableCell colSpan={3}>
                      <TestBadge
                        testing={channel.modelId !== null && testingIds.has(channel.modelId)}
                        result={channel.lastTestResult}
                        latencyMs={channel.lastTestLatencyMs}
                        error={channel.lastTestError}
                        testedAt={channel.lastTestedAt}
                      />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            ) : (
              <div className="empty">ASR 渠道加载中…</div>
            )}
            {canWrite ? (
              <div className="mfoot">
                <Button
                  onClick={() => {
                    const asr = findAsrEntry()
                    if (asr) edit(asr)
                    else setForm({ ...EMPTY_FORM, purposes: ['asr'], protocol: 'minimax' })
                  }}
                >
                  编辑配置
                </Button>
              </div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <Alert variant="destructive" className="mb-3.5">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert className="mb-3.5 border-transparent bg-success-soft text-success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模型条目「{pendingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              已绑定的任务槽会失去该条目，操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) void remove(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function EntryFormCard(props: {
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
          <Label>供应商（选预置自动填端点）</Label>
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
          <Label>Base URL（可修改）</Label>
          <Input
            value={form.baseUrl}
            placeholder="https://api.example.com"
            onChange={(e) => props.setForm({ ...form, baseUrl: e.target.value })}
          />
        </div>
        <div className="mb-3.5 grid gap-1.5">
          <Label>{form.id ? '密钥（留空保留原密钥）' : '密钥'}</Label>
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
}

/**
 * 连通性测试三态徽章（对齐家族 aitech-hub TestStatusBadge 形态）：
 * 测试中 → 「测试中…」；ok → 绿 ✓ + 延迟毫秒；failed → 红 ✗ 失败 + 截断原因
 * （≤48 字，全文悬浮）；未测过 → —。
 */
function TestBadge(props: {
  testing: boolean
  result: string | null
  latencyMs: number | null
  error: string | null
  testedAt: string | null
}) {
  const time = props.testedAt ? (
    <span className="text-xs text-mut"> {props.testedAt.slice(0, 16).replace('T', ' ')}</span>
  ) : null
  if (props.testing) return <span className="text-xs text-mut">测试中…</span>
  if (props.result === 'ok') {
    return (
      <>
        <span
          className="text-success"
          title={props.latencyMs != null ? `${props.latencyMs}ms` : undefined}
        >
          ✓ {props.latencyMs ?? '?'}ms
        </span>
        {time}
      </>
    )
  }
  if (props.result === 'failed') {
    const reason = (props.error ?? '').replace(/\s+/g, ' ').trim()
    return (
      <>
        <span className="text-destructive" title={reason || undefined}>
          ✗ 失败
        </span>
        {reason ? (
          <span className="text-xs text-mut" title={reason}>
            {' '}
            {reason.length > 48 ? `${reason.slice(0, 48)}…` : reason}
          </span>
        ) : null}
        {time}
      </>
    )
  }
  return <>—</>
}

/**
 * 任务槽位绑定卡（对齐家族 aitech-hub BindingCards/RoleCard 形态）：
 * 一槽一卡，主备下拉纵向对齐；「测试主模型」复用条目测试通道，
 * 结果随条目落库并在卡内徽章内联展示；保存/测试反馈在卡内，不动页面级横幅。
 */
function BindingCard(props: {
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
        <Label className="text-[12.5px] text-mut">主模型（必填）</Label>
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
        <Label className="text-[12.5px] text-mut">备用模型（可选）</Label>
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
          <TestBadge
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
}
