'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  AsrChannelView,
  ModelEntryView,
  ModelPurpose,
  ModelProtocol,
  TaskBindingView,
} from '@trend-suite/contracts'
import { Plus, Trash2 } from 'lucide-react'
import { ModelEntryForm } from './ModelEntryForm'
import { ModelBindingCard } from './ModelBindingCard'
import { ModelTestBadge } from './ModelTestBadge'
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

export const PURPOSE_LABELS: Record<ModelPurpose, string> = {
  llm: '内容生成',
  vlm: '视觉理解',
  asr: '语音转写',
  embedding: '向量嵌入',
  image: '图像生成',
}

export const PROTOCOL_LABELS: Record<ModelProtocol, string> = {
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
export function allowedProtocols(purposes: ModelPurpose[]): ModelProtocol[] {
  const sets = purposes.map((p) => PROTOCOLS_BY_PURPOSE[p])
  return (Object.keys(PROTOCOL_LABELS) as ModelProtocol[]).filter((protocol) =>
    sets.every((list) => list.includes(protocol)),
  )
}

/** 可选协议 = 用途允许集 ∩ 厂商支持集；选了预置厂商后不再列出该厂商没有的协议。 */
export function availableProtocols(
  purposes: ModelPurpose[],
  preset: ReturnType<typeof findProviderPreset>,
): ModelProtocol[] {
  const allowed = allowedProtocols(purposes)
  if (!preset) return allowed
  const supported = providerProtocols(preset)
  return allowed.filter((protocol) => supported.includes(protocol))
}

export type EntryForm = {
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
        <TabsList>
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <TabsTrigger key={key} value={key}>
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
              <ModelEntryForm
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
                      <ModelTestBadge
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
            </div>
        </TabsContent>

        <TabsContent value="bindings">
          <div className="card">
            <div className="mt-3.5 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
              {bindings.map((binding) => (
                <ModelBindingCard
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
              {form && form.purposes.includes('asr') ? (
              <ModelEntryForm
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
                      <ModelTestBadge
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

