'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MarketQuoteSourceView } from '@trend-suite/contracts'
import { Trash2 } from 'lucide-react'
import { ApiError } from '@/features/lib/http'
import { createMarketSource, deleteMarketSource, listMarketSources, testMarketSource, updateMarketSource } from '../api'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
  /** 待确认删除的源（AlertDialog 受控；默认源只提示不可删）。 */
  const [pendingDelete, setPendingDelete] = useState<MarketQuoteSourceView | null>(null)

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
          <div className="mfoot mt-0 mb-2.5">
            <Button onClick={() => setForm({ ...EMPTY_FORM })}>新增行情源</Button>
          </div>
        ) : (
          <p className="sub" style={{ margin: 0 }}>只读模式</p>
        )}

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

        {form ? (
          <form
            className="mb-3.5 rounded-xl border border-line bg-soft px-4 py-3.5"
            onSubmit={(event) => {
              void submit(event)
            }}
          >
            <h4 className="mb-3 text-[14.5px] font-bold">{form.id ? '编辑行情源' : '新增行情源'}</h4>
            <div className="grid gap-x-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              <div className="mb-3.5 grid gap-1.5">
                <Label>名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="如：腾讯 fqkline"
                  required
                />
              </div>
              <div className="mb-3.5 grid gap-1.5">
                <Label>Base URL</Label>
                <Input
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="如：https://web.ifzq.gtimg.cn"
                  required
                />
              </div>
              <div className="mb-3.5 grid gap-1.5">
                <Label>备注</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="选填"
                />
              </div>
              <div className="mb-3.5 grid gap-1.5">
                <Label>选项</Label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm({ ...form, enabled: v === true })}
                  />{' '}
                  启用
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={form.isDefault}
                    onCheckedChange={(v) => setForm({ ...form, isDefault: v === true })}
                  />{' '}
                  设为默认源
                </label>
              </div>
            </div>
            <div className="mfoot">
              <Button type="submit" disabled={busy}>
                {busy ? '保存中…' : '保存'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setForm(null)}>
                取消
              </Button>
            </div>
          </form>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>Base URL</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>上次测试</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id}>
                <TableCell>
                  <b>{source.name}</b>
                  {source.isDefault ? <Badge className="ml-1.5">默认</Badge> : null}
                  {source.note ? <span className="text-xs text-mut"> {source.note}</span> : null}
                </TableCell>
                <TableCell>{source.baseUrl}</TableCell>
                <TableCell>{source.enabled ? '启用' : '停用'}</TableCell>
                <TableCell>
                  {testingIds.has(source.id) ? (
                    <span className="text-xs text-mut">测试中…</span>
                  ) : source.lastTestResult === 'ok' ? (
                    <>
                      <span
                        className="text-success"
                        title={source.lastTestLatencyMs != null ? `${source.lastTestLatencyMs}ms` : undefined}
                      >
                        ✓ {source.lastTestLatencyMs ?? '?'}ms
                      </span>
                      {source.lastTestedAt ? (
                        <span className="text-xs text-mut"> {source.lastTestedAt.slice(0, 16).replace('T', ' ')}</span>
                      ) : null}
                    </>
                  ) : source.lastTestResult === 'failed' ? (
                    <>
                      <span className="text-destructive" title={source.lastTestError ?? undefined}>✗ 失败</span>
                      {source.lastTestError ? (
                        <span className="text-xs text-mut" title={source.lastTestError}>
                          {' '}
                          {source.lastTestError.length > 48
                            ? `${source.lastTestError.slice(0, 48)}…`
                            : source.lastTestError}
                        </span>
                      ) : null}
                      {source.lastTestedAt ? (
                        <span className="text-xs text-mut"> {source.lastTestedAt.slice(0, 16).replace('T', ' ')}</span>
                      ) : null}
                    </>
                  ) : (
                    '未测试'
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {canWrite ? (
                    <>
                      <Button
                        variant="link"
                        size="sm"
                        disabled={testingIds.has(source.id)}
                        onClick={() => void runTest(source.id)}
                      >
                        {testingIds.has(source.id) ? '测试中…' : '测试连接'}
                      </Button>
                      <Button variant="link" size="sm" onClick={() => edit(source)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="删除条目"
                        onClick={() => setPendingDelete(source)}
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

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {pendingDelete?.isDefault ? (
              <>
                <AlertDialogTitle>默认行情源不能删除</AlertDialogTitle>
                <AlertDialogDescription>请先把其他源设为默认。</AlertDialogDescription>
              </>
            ) : (
              <>
                <AlertDialogTitle>删除行情源「{pendingDelete?.name}」？</AlertDialogTitle>
                <AlertDialogDescription>
                  删除后运行时回退环境变量默认地址，操作不可恢复。
                </AlertDialogDescription>
              </>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            {pendingDelete?.isDefault ? (
              <AlertDialogAction>知道了</AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={() => {
                  if (pendingDelete) void remove(pendingDelete.id)
                  setPendingDelete(null)
                }}
              >
                删除
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
