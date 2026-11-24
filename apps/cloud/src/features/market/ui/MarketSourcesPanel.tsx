'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MarketQuoteSourceView } from '@trend-suite/contracts'
import { ApiError } from '@/features/lib/http'
import { IconTrash } from '@/features/lib/icons'
import { createMarketSource, deleteMarketSource, listMarketSources, testMarketSource, updateMarketSource } from '../api'

type SourceForm = {
  id: string | null
  name: string
  baseUrl: string
  note: string
  enabled: boolean
  isDefault: boolean
}

const EMPTY_FORM: SourceForm = {
  id: null,
  name: '',
  baseUrl: '',
  note: '',
  enabled: true,
  isDefault: false,
}

/** 运营控制台 · 行情源（教师端需求 P4）：K 线来源不再 hardcode，运营在此维护。 */
export function MarketSourcesPanel({ canWrite }: { canWrite: boolean }) {
  const [sources, setSources] = useState<MarketQuoteSourceView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState<SourceForm | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在连通性测试的条目 id：行内按钮变「测试中…」，列表徽章同步。 */
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      setSources(await listMarketSources())
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '行情源加载失败')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function edit(source: MarketQuoteSourceView) {
    setNotice(null)
    setForm({
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      note: source.note ?? '',
      enabled: source.enabled,
      isDefault: source.isDefault,
    })
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (form.id) {
        await updateMarketSource(form.id, {
          name: form.name,
          baseUrl: form.baseUrl,
          note: form.note === '' ? null : form.note,
          enabled: form.enabled,
          isDefault: form.isDefault,
        })
        setNotice('已保存')
      } else {
        await createMarketSource({
          name: form.name,
          baseUrl: form.baseUrl,
          note: form.note === '' ? undefined : form.note,
          enabled: form.enabled,
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

  /** 测试结果随条目落库（与模型配置同一呈现口径），仅请求本身异常才横幅报错。 */
  async function runTest(id: string) {
    setError(null)
    setTestingIds((prev) => new Set(prev).add(id))
    try {
      await testMarketSource(id)
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
      await deleteMarketSource(id)
      await refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <section>
      <div className="card">
        {canWrite ? (
          <div className="mfoot" style={{ marginTop: 0, marginBottom: 10 }}>
            <button type="button" className="btn primary" onClick={() => setForm({ ...EMPTY_FORM })}>
              新增行情源
            </button>
          </div>
        ) : (
          <div className="meta">当前角色只读：只有管理员可以维护行情源配置。</div>
        )}

        {error ? <div className="notice err">{error}</div> : null}
        {notice ? <div className="notice ok">{notice}</div> : null}

        {form ? (
          <form
            className="entry-form"
            onSubmit={(event) => {
              void submit(event)
            }}
          >
            <h4>{form.id ? '编辑行情源' : '新增行情源'}</h4>
            <div className="grid2">
              <label className="field">
                <span>名称</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：腾讯 fqkline"
                  required
                />
              </label>
              <label className="field">
                <span>Base URL</span>
                <input
                  className="input"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="如：https://web.ifzq.gtimg.cn"
                  required
                />
              </label>
              <label className="field">
                <span>备注</span>
                <input
                  className="input"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="选填"
                />
              </label>
              <div className="field">
                <span>选项</span>
                <label>
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  />{' '}
                  启用
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  />{' '}
                  设为默认源
                </label>
              </div>
            </div>
            <div className="mfoot">
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </button>
              <button type="button" className="btn" onClick={() => setForm(null)}>
                取消
              </button>
            </div>
          </form>
        ) : null}

        <table className="data-tbl">
          <thead>
            <tr>
              <th>名称</th>
              <th>Base URL</th>
              <th>状态</th>
              <th>上次测试</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.id}>
                <td>
                  <b>{source.name}</b>
                  {source.isDefault ? <span className="tag">默认</span> : null}
                  {source.note ? <span className="meta"> {source.note}</span> : null}
                </td>
                <td>{source.baseUrl}</td>
                <td>{source.enabled ? '启用' : '停用'}</td>
                <td>
                  {testingIds.has(source.id) ? (
                    <span className="meta">测试中…</span>
                  ) : source.lastTestResult === 'ok' ? (
                    <>
                      <span
                        className="ok-text"
                        title={source.lastTestLatencyMs != null ? `${source.lastTestLatencyMs}ms` : undefined}
                      >
                        ✓ {source.lastTestLatencyMs ?? '?'}ms
                      </span>
                      {source.lastTestedAt ? (
                        <span className="meta"> {source.lastTestedAt.slice(0, 16).replace('T', ' ')}</span>
                      ) : null}
                    </>
                  ) : source.lastTestResult === 'failed' ? (
                    <>
                      <span className="err-text" title={source.lastTestError ?? undefined}>✗ 失败</span>
                      {source.lastTestError ? (
                        <span className="meta" title={source.lastTestError}>
                          {' '}
                          {source.lastTestError.length > 48
                            ? `${source.lastTestError.slice(0, 48)}…`
                            : source.lastTestError}
                        </span>
                      ) : null}
                      {source.lastTestedAt ? (
                        <span className="meta"> {source.lastTestedAt.slice(0, 16).replace('T', ' ')}</span>
                      ) : null}
                    </>
                  ) : (
                    '未测试'
                  )}
                </td>
                <td className="num">
                  {canWrite ? (
                    <>
                      <button
                        type="button"
                        className="btn link"
                        disabled={testingIds.has(source.id)}
                        onClick={() => void runTest(source.id)}
                      >
                        {testingIds.has(source.id) ? '测试中…' : '测试连接'}
                      </button>
                      <button type="button" className="btn link" onClick={() => edit(source)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="iconbtn danger"
                        title="删除条目"
                        aria-label="删除条目"
                        onClick={() => {
                          if (
                            window.confirm(
                              source.isDefault
                                ? '默认行情源不能删除，请先把其他源设为默认。'
                                : `删除行情源「${source.name}」？删除后运行时回退环境变量默认地址，操作不可恢复。`,
                            )
                          ) {
                            void remove(source.id)
                          }
                        }}
                      >
                        <IconTrash />
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
          运行时取默认启用源（缓存 ≤60 秒）；显式设置环境变量 MARKET_QUOTES_BASE_URL 时该变量优先（本地开发口径）。测试连接会真实拉一次样本 K 线。
        </p>
      </div>
    </section>
  )
}
