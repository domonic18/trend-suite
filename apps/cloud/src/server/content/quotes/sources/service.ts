import 'server-only'
import {
  type MarketQuoteSourceView,
  type MarketSourceTestResultView,
  type UpdateMarketSourceRequest,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { badRequest, forbidden, notFound } from '@/server/lib/http'
import { fetchQuotes } from '../client'
import * as repo from './repo'

/**
 * 行情源配置（arch/06 §5 口径不变，来源可配）：运营侧维护，admin 可写、operator 只读
 * （与模型配置同一权限口径——换源等于换行情出流量向）。
 * 测试连接与正式调用走同一客户端分支（fetchQuotes），避免「测试通、实际不通」。
 */

function toView(row: repo.MarketQuoteSourceRow): MarketQuoteSourceView {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    enabled: row.enabled,
    isDefault: row.is_default,
    note: row.note,
    lastTestedAt: row.last_tested_at ? row.last_tested_at.toISOString() : null,
    lastTestResult: row.last_test_result,
    lastTestLatencyMs: row.last_test_latency_ms,
    lastTestError: row.last_test_error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function listMarketSources(): Promise<MarketQuoteSourceView[]> {
  const rows = await repo.listSources()
  return rows.map(toView)
}

export async function createMarketSource(input: {
  name: string
  baseUrl: string
  note?: string | undefined
  enabled?: boolean | undefined
  isDefault?: boolean | undefined
}): Promise<MarketQuoteSourceView> {
  if (input.isDefault) await repo.clearDefaults()
  const row = await repo.insertSource({
    id: newId('marketSource'),
    name: input.name,
    baseUrl: input.baseUrl.replace(/\/+$/, ''),
    enabled: input.enabled ?? true,
    isDefault: input.isDefault ?? false,
    note: input.note ?? null,
  })
  return toView(row)
}

export async function updateMarketSource(
  id: string,
  input: UpdateMarketSourceRequest,
): Promise<MarketQuoteSourceView> {
  const existing = await repo.findSourceById(id)
  if (!existing) throw notFound('行情源条目不存在')
  if (input.isDefault) await repo.clearDefaults(id)
  const row = await repo.updateSource(id, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl.replace(/\/+$/, '') } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
  })
  return toView(row)
}

export async function deleteMarketSource(id: string): Promise<void> {
  const existing = await repo.findSourceById(id)
  if (!existing) throw notFound('行情源条目不存在')
  if (existing.is_default) throw badRequest('默认行情源不能删除，请先把其他源设为默认')
  await repo.deleteSource(id)
}

/**
 * 连通性测试：与正式调用同一客户端（fetchQuotes，腾讯 fqkline 协议）。
 * 探测一只 A 股样本（浦发银行 600000）的日线近 20 根；结果随条目落库内联展示。
 */
export async function testMarketSource(id: string): Promise<MarketSourceTestResultView> {
  const row = await repo.findSourceById(id)
  if (!row) throw notFound('行情源条目不存在')

  const started = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  let outcome: { ok: boolean; message: string; sampleBars: number }
  try {
    const bars = await fetchQuotes(
      { code: '600000', exchange: 'SH' },
      '1d',
      '2025-01-01',
      today,
      { baseUrl: row.base_url },
    )
    if (bars.length === 0) {
      outcome = { ok: false, message: '连通但窗口内没有 K 线数据', sampleBars: 0 }
    } else {
      outcome = {
        ok: true,
        message: `连通正常，样本 ${bars.length} 根（最新 ${bars[bars.length - 1]!.d}）`,
        sampleBars: bars.length,
      }
    }
  } catch (err) {
    outcome = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      sampleBars: 0,
    }
  }

  const testedAt = new Date()
  const latencyMs = Date.now() - started
  await repo.updateSource(id, {
    lastTestedAt: testedAt,
    lastTestResult: outcome.ok ? 'ok' : 'failed',
    lastTestLatencyMs: latencyMs,
    lastTestError: outcome.ok ? null : outcome.message.slice(0, 500),
  })
  return {
    ok: outcome.ok,
    message: outcome.message,
    latencyMs,
    sampleBars: outcome.sampleBars,
    testedAt: testedAt.toISOString(),
  }
}

/** 运营只读：调用方角色判断（admin 可写），与模型配置同一口径。 */
export function assertCanWriteMarketSources(role: string): void {
  if (role !== 'admin') throw forbidden('只有管理员可以维护行情源配置')
}
