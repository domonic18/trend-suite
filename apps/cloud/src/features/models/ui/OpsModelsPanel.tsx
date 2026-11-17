'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  AsrChannelView,
  ModelEntryView,
  ModelPurpose,
  ModelProtocol,
  TaskBindingView,
} from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { MODEL_PROVIDERS, OTHER_PROVIDER, findProviderPreset } from '../providers'
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

type EntryForm = {
  id: string | null
  name: string
  purposes: ModelPurpose[]
  provider: string
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

  async function runTest(id: string) {
    setError(null)
    setNotice(null)
    try {
      const result = await testModel(id)
      setNotice(`${result.ok ? '连通' : '不通'}：${result.message}（${result.latencyMs}ms）`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '测试失败')
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

  async function saveSlot(binding: TaskBindingView, primaryModelId: string, backupModelId: string) {
    setError(null)
    try {
      await saveBinding({
        task: binding.task,
        primaryModelId,
        backupModelId: backupModelId || null,
      })
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '绑定保存失败')
    }
  }

  return (
    <section>
      <div className="ops-tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'ops-tab on' : 'ops-tab'}
            onClick={() => setTab(key)}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {error ? <div className="notice err">{error}</div> : null}
      {notice ? <div className="notice ok">{notice}</div> : null}

      {tab === 'entries' ? (
        <div className="card">
          {canWrite ? (
            <div className="mfoot" style={{ marginTop: 0, marginBottom: 10 }}>
              <button type="button" className="btn primary" onClick={() => setForm({ ...EMPTY_FORM })}>
                新增模型
              </button>
            </div>
          ) : (
            <div className="meta">当前角色只读：只有管理员可以维护模型配置。</div>
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

          <table className="data-tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th>用途</th>
                <th>协议</th>
                <th>模型</th>
                <th>密钥</th>
                <th>状态</th>
                <th>上次测试</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {models.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <b>{entry.name}</b>
                    {entry.isDefault ? <span className="tag">默认</span> : null}
                  </td>
                  <td>{entry.purposes.map((p) => PURPOSE_LABELS[p]).join(' + ')}</td>
                  <td>{PROTOCOL_LABELS[entry.protocol]}</td>
                  <td>{entry.model}</td>
                  <td>{entry.apiKeyMasked ?? '未配置'}</td>
                  <td>{entry.status === 'active' ? '启用' : entry.status === 'cooling' ? '冷却' : '禁用'}</td>
                  <td>
                    {entry.lastTestedAt ? (
                      <>
                        {entry.lastTestResult === 'ok' ? '正常' : '异常'}
                        <span className="meta"> {entry.lastTestedAt.slice(0, 16).replace('T', ' ')}</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">
                    {canWrite ? (
                      <>
                        <button type="button" className="btn link" onClick={() => void runTest(entry.id)}>
                          测试
                        </button>
                        <button type="button" className="btn link" onClick={() => edit(entry)}>
                          编辑
                        </button>
                        <button
                          type="button"
                          className="btn link err-text"
                          onClick={() => void remove(entry.id)}
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta">
            连通性测试会真实调用一次（需计费）。密钥加密存储，列表只回掩码。
          </p>
        </div>
      ) : null}

      {tab === 'bindings' ? (
        <div className="card">
          <p className="meta">
            每槽位绑定主模型（必填）与可选备用；备用不可与主模型相同。下拉只列出与槽位用途匹配且启用的条目。
          </p>
          {bindings.map((binding) => (
            <BindingRow
              key={binding.task}
              binding={binding}
              models={models}
              canWrite={canWrite}
              onSave={saveSlot}
            />
          ))}
        </div>
      ) : null}

      {tab === 'asr' ? (
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
            <table className="data-tbl desc">
              <tbody>
                <tr>
                  <th>供应商</th>
                  <td>{channel.provider || '未配置'}</td>
                  <th>调用协议</th>
                  <td>{PROTOCOL_LABELS[channel.protocol]}</td>
                </tr>
                <tr>
                  <th>模型</th>
                  <td>{channel.model || '未配置'}</td>
                  <th>Base URL</th>
                  <td>{channel.baseUrl || '未配置'}</td>
                </tr>
                <tr>
                  <th>API Key</th>
                  <td>{channel.apiKeyMasked ?? '未配置'}</td>
                  <th>状态</th>
                  <td>{channel.status === 'active' ? '启用' : channel.status === 'cooling' ? '冷却' : '禁用'}</td>
                </tr>
                <tr>
                  <th>单条音频时长上限</th>
                  <td>{channel.maxAudioSeconds} 秒</td>
                  <th>热词</th>
                  <td>
                    {channel.hotwordSupported ? `${channel.hotwordCount} 个` : '该协议不支持热词注入'}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <div className="empty">ASR 渠道加载中…</div>
          )}
          {canWrite ? (
            <div className="mfoot">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const asr = findAsrEntry()
                  if (asr) edit(asr)
                  else setForm({ ...EMPTY_FORM, purposes: ['asr'], protocol: 'minimax' })
                }}
              >
                编辑配置
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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

  /** 用途 toggle：至少一项；协议随所选用途交集收缩（当前协议不在交集内则重置为交集第一个）。 */
  function togglePurpose(purpose: ModelPurpose) {
    const next = form.purposes.includes(purpose)
      ? form.purposes.filter((p) => p !== purpose)
      : [...form.purposes, purpose]
    if (next.length === 0) return
    const allowed = allowedProtocols(next)
    props.setForm({
      ...form,
      purposes: next,
      protocol: allowed.includes(form.protocol) ? form.protocol : (allowed[0] ?? 'openai'),
    })
  }

  /** 选厂商：预置项自动填协议（在当前用途交集内才覆盖）与 Base URL（空或另一预置值才覆盖）。 */
  function pickProvider(provider: string) {
    if (provider === OTHER_PROVIDER || provider === '') {
      props.setForm({ ...form, provider: '' })
      return
    }
    const preset = findProviderPreset(provider)
    if (!preset) {
      props.setForm({ ...form, provider })
      return
    }
    const allowed = allowedProtocols(form.purposes)
    const baseUrlUsable =
      form.baseUrl === '' ||
      MODEL_PROVIDERS.some((p) => p.baseUrl === form.baseUrl)
    props.setForm({
      ...form,
      provider: preset.label,
      protocol: allowed.includes(preset.protocol) ? preset.protocol : form.protocol,
      baseUrl: baseUrlUsable ? preset.baseUrl : form.baseUrl,
    })
  }

  return (
    <form className="entry-form" onSubmit={props.onSubmit}>
      <h4>{form.id ? '编辑模型条目' : '新增模型条目'}</h4>
      <div className="grid2">
        <label className="field">
          <span>名称</span>
          <input
            className="input"
            value={form.name}
            onChange={(e) => props.setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <div className="field">
          <span>用途（可多选）</span>
          <div className="purpose-toggles">
            {(Object.keys(PURPOSE_LABELS) as ModelPurpose[]).map((purpose) => (
              <button
                key={purpose}
                type="button"
                className={form.purposes.includes(purpose) ? 'ptg on' : 'ptg'}
                aria-pressed={form.purposes.includes(purpose)}
                onClick={() => togglePurpose(purpose)}
              >
                {PURPOSE_LABELS[purpose]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>供应商（选预置自动填端点）</span>
          <select
            className="input"
            value={findProviderPreset(form.provider) ? form.provider : form.provider === '' ? '' : OTHER_PROVIDER}
            onChange={(e) => pickProvider(e.target.value)}
          >
            <option value="">请选择</option>
            {MODEL_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value={OTHER_PROVIDER}>其他（手动填写）</option>
          </select>
        </label>
        {form.provider === '' || findProviderPreset(form.provider) ? null : (
          <label className="field">
            <span>供应商名称</span>
            <input
              className="input"
              value={form.provider}
              onChange={(e) => props.setForm({ ...form, provider: e.target.value })}
              required
            />
          </label>
        )}
        <label className="field">
          <span>调用协议</span>
          <select
            className="input"
            value={form.protocol}
            onChange={(e) =>
              props.setForm({ ...form, protocol: e.target.value as ModelProtocol })
            }
          >
            {allowedProtocols(form.purposes).map((protocol) => (
              <option key={protocol} value={protocol}>
                {PROTOCOL_LABELS[protocol]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>模型名</span>
          <input
            className="input"
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
        </label>
        <label className="field">
          <span>Base URL（可修改）</span>
          <input
            className="input"
            value={form.baseUrl}
            placeholder="https://api.example.com"
            onChange={(e) => props.setForm({ ...form, baseUrl: e.target.value })}
          />
        </label>
        <label className="field">
          <span>{form.id ? '密钥（留空保留原密钥）' : '密钥'}</span>
          <input
            className="input"
            type="password"
            value={form.apiKey}
            placeholder={form.id ? '留空即保留原密钥' : ''}
            onChange={(e) => props.setForm({ ...form, apiKey: e.target.value })}
          />
        </label>
        <label className="field">
          <span>默认条目</span>
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => props.setForm({ ...form, isDefault: e.target.checked })}
          />
        </label>
      </div>
      <div className="mfoot">
        <button type="submit" className="btn primary" disabled={props.busy}>
          保存
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}

function BindingRow(props: {
  binding: TaskBindingView
  models: ModelEntryView[]
  canWrite: boolean
  onSave: (
    binding: TaskBindingView,
    primaryModelId: string,
    backupModelId: string,
  ) => Promise<void>
}) {
  const usable = props.models.filter(
    (m) => m.purposes.includes(props.binding.purpose) && m.status === 'active',
  )
  const [primary, setPrimary] = useState(props.binding.primaryModelId ?? '')
  const [backup, setBackup] = useState(props.binding.backupModelId ?? '')

  useEffect(() => {
    setPrimary(props.binding.primaryModelId ?? '')
    setBackup(props.binding.backupModelId ?? '')
  }, [props.binding.primaryModelId, props.binding.backupModelId])

  return (
    <div className="bind-row">
      <div className="row-lbl">{props.binding.taskLabel}</div>
      <div className="meta">
        {props.binding.task} · 用途 {PURPOSE_LABELS[props.binding.purpose]}
      </div>
      <div className="bind">
        <span className="k">主模型</span>
        <select
          className="input"
          value={primary}
          disabled={!props.canWrite}
          onChange={(e) => setPrimary(e.target.value)}
        >
          <option value="">请选择</option>
          {usable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}（{m.model}）
            </option>
          ))}
        </select>
      </div>
      <div className="bind">
        <span className="k">备用模型</span>
        <select
          className="input"
          value={backup}
          disabled={!props.canWrite}
          onChange={(e) => setBackup(e.target.value)}
        >
          <option value="">可选</option>
          {usable
            .filter((m) => m.id !== primary)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.model}）
              </option>
            ))}
        </select>
        {props.canWrite ? (
          <button
            type="button"
            className="btn"
            disabled={!primary}
            onClick={() => void props.onSave(props.binding, primary, backup)}
          >
            保存
          </button>
        ) : null}
      </div>
    </div>
  )
}
