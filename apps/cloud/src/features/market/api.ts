'use client'

import {
  marketQuoteSourceListResponse,
  marketQuoteSourceView,
  marketSourceTestResultView,
  type CreateMarketSourceRequest,
  type MarketQuoteSourceView,
  type MarketSourceTestResultView,
  type UpdateMarketSourceRequest,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

export async function listMarketSources(): Promise<MarketQuoteSourceView[]> {
  const data = await apiRequest<unknown>('/v1/ops/market-sources')
  return marketQuoteSourceListResponse.parse(data).items
}

export async function createMarketSource(
  input: CreateMarketSourceRequest,
): Promise<MarketQuoteSourceView> {
  const data = await apiRequest<unknown>('/v1/ops/market-sources', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return marketQuoteSourceView.parse((data as { item: unknown }).item)
}

export async function updateMarketSource(
  id: string,
  input: UpdateMarketSourceRequest,
): Promise<MarketQuoteSourceView> {
  const data = await apiRequest<unknown>(`/v1/ops/market-sources/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return marketQuoteSourceView.parse((data as { item: unknown }).item)
}

export async function deleteMarketSource(id: string): Promise<void> {
  await apiRequest<unknown>(`/v1/ops/market-sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function testMarketSource(id: string): Promise<MarketSourceTestResultView> {
  const data = await apiRequest<unknown>(`/v1/ops/market-sources/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  })
  return marketSourceTestResultView.parse((data as { result: unknown }).result)
}
