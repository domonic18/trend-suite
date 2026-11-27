'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AsrChannelView, ModelEntryView, ModelPurpose, TaskBindingView } from '@trend-suite/contracts'
import { Cpu, Plus, Trash2 } from 'lucide-react'
import { ModelEntryForm } from './ModelEntryForm'
import { ModelBindingCard } from './ModelBindingCard'
import { ModelTestBadge } from './ModelTestBadge'
import { ApiError } from '@/features/lib/http'
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
import {
  allowedProtocols,
  availableProtocols,
  findProviderPreset,
  providerProtocols,
  PURPOSE_LABELS,
  PROTOCOL_LABELS,
  type EntryForm,
} from '../providers'
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
      <section className="settings-section">
          <div className="settings-heading">
            <h3>模型条目</h3>
            {canWrite ? (
              <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>
                <Plus className="size-4" /> 新增
              </Button>
            ) : null}
          </div>

          {models.length === 0 ? (
            <div className="settings-empty">
              <Cpu className="size-8 text-pri" strokeWidth={1.3} aria-hidden="true" />
              <h4>还没有模型条目</h4>
            </div>
          ) : (
            models.map((entry) => (
              <div className="settings-row" key={entry.id}>
                <div className="row-info">
                  <div className="row-name">
                    <h4>{entry.name}</h4>
                    {entry.isDefault ? (
                      <Badge className="rounded-full bg-pri-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                        默认
                      </Badge>
                    ) : null}
                  </div>
                  <div className="row-meta">
                    <code>{entry.model}</code>
                    <span>{entry.purposes.map((p) => PURPOSE_LABELS[p]).join(' + ')}</span>
                    <span>{PROTOCOL_LABELS[entry.protocol]}</span>
                    <span>
                      {entry.apiKeyMasked ? '已配密钥' : '未配密钥'} ·{' '}
                      {entry.status === 'active' ? '启用' : entry.status === 'cooling' ? '冷却' : '禁用'}
                    </span>
                  </div>
                </div>
                <div className="row-controls">
                  <ModelTestBadge
                    testing={testingIds.has(entry.id)}
                    result={entry.lastTestResult}
                    latencyMs={entry.lastTestLatencyMs}
                    error={entry.lastTestError}
                    testedAt={entry.lastTestedAt}
                  />
                  {canWrite ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={testingIds.has(entry.id)}
                        onClick={() => void runTest(entry.id)}
                      >
                        {testingIds.has(entry.id) ? '测试中…' : '测试连接'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => edit(entry)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive hover:text-destructive"
                        aria-label="删除条目"
                        onClick={() => setPendingDelete(entry)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </section>

        <section className="settings-section">
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
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>ASR 渠道</h3>
            {canWrite ? (
              <Button
                size="sm"
                onClick={() => {
                  const asr = findAsrEntry()
                  if (asr) edit(asr)
                  else setForm({ ...EMPTY_FORM, purposes: ['asr'], protocol: 'minimax' })
                }}
              >
                <Plus className="size-4" /> 编辑配置
              </Button>
            ) : null}
          </div>

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
            <div className="settings-row">
              <div className="row-info">
                <div className="row-name">
                  <h4>{channel.provider || '未配置'}</h4>
                </div>
                <div className="row-meta">
                  {channel.model ? <code>{channel.model}</code> : null}
                  <span>{PROTOCOL_LABELS[channel.protocol]}</span>
                  {channel.baseUrl ? <span>{channel.baseUrl}</span> : null}
                  <span>{channel.apiKeyMasked ? '已配密钥' : '未配密钥'} · {channel.status === 'active' ? '启用' : channel.status === 'cooling' ? '冷却' : '禁用'}</span>
                  <span>单条音频 ≤ {channel.maxAudioSeconds}s</span>
                  {channel.hotwordSupported ? <span>热词 {channel.hotwordCount} 个</span> : null}
                </div>
              </div>
              <div className="row-controls">
                <ModelTestBadge
                  testing={channel.modelId !== null && testingIds.has(channel.modelId)}
                  result={channel.lastTestResult}
                  latencyMs={channel.lastTestLatencyMs}
                  error={channel.lastTestError}
                  testedAt={channel.lastTestedAt}
                />
              </div>
            </div>
          ) : (
            <div className="empty">ASR 渠道加载中…</div>
          )}
        </section>

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

