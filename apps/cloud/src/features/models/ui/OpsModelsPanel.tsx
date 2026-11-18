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
      <div className="ops-tabs">
        {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'ops-tab on' : 'ops-tab'}
            onClick={() => {
              setTab(key)
              // 横幅是上一个 tab 的操作反馈，切走即清（避免挂在下一个 tab 顶部撑动布局）
              setError(null)
              setNotice(null)
            }}
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
                    <TestBadge
                      testing={testingIds.has(entry.id)}
                      result={entry.lastTestResult}
                      latencyMs={entry.lastTestLatencyMs}
                      error={entry.lastTestError}
                      testedAt={entry.lastTestedAt}
                    />
                  </td>
                  <td className="num">
                    {canWrite ? (
                      <>
                        <button
                          type="button"
                          className="btn link"
                          disabled={testingIds.has(entry.id)}
                          onClick={() => void runTest(entry.id)}
                        >
                          {testingIds.has(entry.id) ? '测试中…' : '测试'}
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
            每槽位绑定主模型（必填）与可选备用；备用不可与主模型相同。下拉只列出与槽位用途匹配且启用的条目；「测试主模型」对当前选中的主模型发起连通性测试（真实调用一次，需计费）。
          </p>
          <div className="bind-grid">
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
                <tr>
                  <th>最后测试</th>
                  <td colSpan={3}>
                    <TestBadge
                      testing={channel.modelId !== null && testingIds.has(channel.modelId)}
                      result={channel.lastTestResult}
                      latencyMs={channel.lastTestLatencyMs}
                      error={channel.lastTestError}
                      testedAt={channel.lastTestedAt}
                    />
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
            value={form.custom ? OTHER_PROVIDER : preset ? preset.value : ''}
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
        {form.custom ? (
          <label className="field">
            <span>供应商名称</span>
            <input
              className="input"
              value={form.provider}
              onChange={(e) => props.setForm({ ...form, provider: e.target.value })}
              required
            />
          </label>
        ) : null}
        <label className="field">
          <span>调用协议</span>
          <select
            className="input"
            value={form.protocol}
            onChange={(e) => pickProtocol(e.target.value as ModelProtocol)}
          >
            {availableProtocols(form.purposes, preset).map((protocol) => (
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
    <span className="meta"> {props.testedAt.slice(0, 16).replace('T', ' ')}</span>
  ) : null
  if (props.testing) return <span className="meta">测试中…</span>
  if (props.result === 'ok') {
    return (
      <>
        <span className="ok-text" title={props.latencyMs != null ? `${props.latencyMs}ms` : undefined}>
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
        <span className="err-text" title={reason || undefined}>✗ 失败</span>
        {reason ? (
          <span className="meta" title={reason}>
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
    <div className="bind-card" role="group" aria-label={`${props.binding.taskLabel}绑定`}>
      <div className="bind-head">
        <b>{props.binding.taskLabel}</b>
        <span className="tag">{PURPOSE_LABELS[props.binding.purpose]}</span>
      </div>
      <div className="meta">{props.binding.task}</div>
      <label className="field">
        <span>主模型（必填）</span>
        <select
          className="input"
          value={primary}
          disabled={!props.canWrite}
          onChange={(e) => {
            setPrimary(e.target.value)
            setSaved(false)
          }}
        >
          <option value="">请选择</option>
          {usable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}（{m.model}）
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>备用模型（可选）</span>
        <select
          className="input"
          value={backup}
          disabled={!props.canWrite}
          onChange={(e) => {
            setBackup(e.target.value)
            setSaved(false)
          }}
        >
          <option value="">无备用</option>
          {usable
            .filter((m) => m.id !== primary)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}（{m.model}）
              </option>
            ))}
        </select>
      </label>
      <div className="bind-test">
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
          <span className="meta">未选择主模型</span>
        )}
      </div>
      {error ? <p className="err-text">{error}</p> : null}
      {saved && !error ? <p className="meta">已保存，下一次任务即生效</p> : null}
      {props.canWrite ? (
        <div className="bind-foot">
          <button
            type="button"
            className="btn"
            disabled={!primary || testing}
            onClick={() => void props.onTest(primary)}
          >
            {testing ? '测试中…' : '测试主模型'}
          </button>
          <button type="button" className="btn primary" disabled={busy || !primary} onClick={() => void save()}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
