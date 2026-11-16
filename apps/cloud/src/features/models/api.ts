'use client'

import {
  asrChannelResponse,
  modelEntryListResponse,
  modelEntryView,
  modelTestResultView,
  taskBindingListResponse,
  type AsrChannelView,
  type CreateModelEntryRequest,
  type ModelEntryView,
  type ModelTestResultView,
  type TaskBindingView,
  type UpdateModelEntryRequest,
  type UpdateTaskBindingRequest,
} from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'

export async function listModels(): Promise<ModelEntryView[]> {
  const data = await apiRequest<unknown>('/v1/ops/models')
  return modelEntryListResponse.parse(data).items
}

export async function createModel(input: CreateModelEntryRequest): Promise<ModelEntryView> {
  const data = await apiRequest<unknown>('/v1/ops/models', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return modelEntryView.parse((data as { item: unknown }).item)
}

export async function updateModel(
  id: string,
  input: UpdateModelEntryRequest,
): Promise<ModelEntryView> {
  const data = await apiRequest<unknown>(`/v1/ops/models/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return modelEntryView.parse((data as { item: unknown }).item)
}

export async function deleteModel(id: string): Promise<void> {
  await apiRequest<unknown>(`/v1/ops/models/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function testModel(id: string): Promise<ModelTestResultView> {
  const data = await apiRequest<unknown>(`/v1/ops/models/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  })
  return modelTestResultView.parse((data as { result: unknown }).result)
}

export async function listBindings(): Promise<TaskBindingView[]> {
  const data = await apiRequest<unknown>('/v1/ops/model-bindings')
  return taskBindingListResponse.parse(data).items
}

export async function saveBinding(input: UpdateTaskBindingRequest): Promise<TaskBindingView> {
  const data = await apiRequest<unknown>('/v1/ops/model-bindings', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return (data as { item: TaskBindingView }).item
}

export async function getAsrChannel(): Promise<AsrChannelView> {
  const data = await apiRequest<unknown>('/v1/ops/asr-channel')
  return asrChannelResponse.parse(data).channel
}
