import 'server-only'
import { query, queryOne } from '@/server/lib/db'

export type ModelRow = {
  id: string
  name: string
  purposes: string[]
  provider: string
  protocol: string
  model: string
  base_url: string | null
  api_key_enc: string | null
  status: string
  is_default: boolean
  meta: Record<string, unknown>
  cooldown_until: Date | null
  last_tested_at: Date | null
  last_test_result: string | null
  last_test_latency_ms: number | null
  last_test_error: string | null
  created_at: Date
  updated_at: Date
}

export type BindingRow = {
  task: string
  primary_model_id: string
  backup_model_id: string | null
  updated_at: Date
}

const COLUMNS = [
  'id',
  'name',
  'purposes',
  'provider',
  'protocol',
  'model',
  'base_url',
  'api_key_enc',
  'status',
  'is_default',
  'meta',
  'cooldown_until',
  'last_tested_at',
  'last_test_result',
  'last_test_latency_ms',
  'last_test_error',
  'created_at',
  'updated_at',
].join(', ')

export function listModels(): Promise<ModelRow[]> {
  return query<ModelRow>(
    `SELECT ${COLUMNS} FROM ai_models ORDER BY is_default DESC, created_at`,
  )
}

export function findModelById(id: string): Promise<ModelRow | null> {
  return queryOne<ModelRow>(`SELECT ${COLUMNS} FROM ai_models WHERE id = $1`, [id])
}

/** 用途的默认条目：运行时按用途取它（ingest 取 ASR，generate 取内容 LLM）。 */
export function findDefaultModel(purpose: string): Promise<ModelRow | null> {
  return queryOne<ModelRow>(
    `SELECT ${COLUMNS} FROM ai_models
     WHERE $1 = ANY(purposes) AND status = 'active'
     ORDER BY is_default DESC, created_at
     LIMIT 1`,
    [purpose],
  )
}

/**
 * 该用途下已配置密钥的可用条目（含冷却中的，供路由判断冷却）。
 * 冷却中的条目不出现在候选首位（arch/07 §9）。
 */
export function listUsableModels(purpose: string): Promise<ModelRow[]> {
  return query<ModelRow>(
    `SELECT ${COLUMNS} FROM ai_models
     WHERE $1 = ANY(purposes) AND status IN ('active', 'cooling')
     ORDER BY is_default DESC, created_at`,
    [purpose],
  )
}

export async function insertModel(input: {
  id: string
  name: string
  purposes: string[]
  provider: string
  protocol: string
  model: string
  baseUrl: string | null
  apiKeyEnc: string | null
  isDefault: boolean
  meta: Record<string, unknown>
}): Promise<ModelRow> {
  const row = await queryOne<ModelRow>(
    `INSERT INTO ai_models (id, name, purposes, provider, protocol, model, base_url, api_key_enc,
                            is_default, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING ${COLUMNS}`,
    [
      input.id,
      input.name,
      input.purposes,
      input.provider,
      input.protocol,
      input.model,
      input.baseUrl,
      input.apiKeyEnc,
      input.isDefault,
      JSON.stringify(input.meta),
    ],
  )
  if (!row) throw new Error('模型条目写入失败')
  return row
}

export async function updateModel(
  id: string,
  input: {
    name?: string
    purposes?: string[]
    provider?: string
    protocol?: string
    model?: string
    baseUrl?: string | null
    apiKeyEnc?: string | null
    isDefault?: boolean
    status?: string
    meta?: Record<string, unknown>
    cooldownUntil?: Date | null
    lastTestedAt?: Date | null
    lastTestResult?: string | null
    lastTestLatencyMs?: number | null
    lastTestError?: string | null
  },
): Promise<ModelRow> {
  const sets: string[] = []
  const values: unknown[] = []

  const put = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }

  if (input.name !== undefined) put('name', input.name)
  if (input.purposes !== undefined) put('purposes', input.purposes)
  if (input.provider !== undefined) put('provider', input.provider)
  if (input.protocol !== undefined) put('protocol', input.protocol)
  if (input.model !== undefined) put('model', input.model)
  if (input.baseUrl !== undefined) put('base_url', input.baseUrl)
  if (input.apiKeyEnc !== undefined) put('api_key_enc', input.apiKeyEnc)
  if (input.isDefault !== undefined) put('is_default', input.isDefault)
  if (input.status !== undefined) put('status', input.status)
  if (input.meta !== undefined) put('meta', JSON.stringify(input.meta))
  if (input.cooldownUntil !== undefined) put('cooldown_until', input.cooldownUntil)
  if (input.lastTestedAt !== undefined) put('last_tested_at', input.lastTestedAt)
  if (input.lastTestResult !== undefined) put('last_test_result', input.lastTestResult)
  if (input.lastTestLatencyMs !== undefined) put('last_test_latency_ms', input.lastTestLatencyMs)
  if (input.lastTestError !== undefined) put('last_test_error', input.lastTestError)

  if (sets.length === 0) {
    const existing = await findModelById(id)
    if (!existing) throw new Error('模型条目不存在')
    return existing
  }

  values.push(id)
  sets.push('updated_at = now()')
  const row = await queryOne<ModelRow>(
    `UPDATE ai_models SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${COLUMNS}`,
    values,
  )
  if (!row) throw new Error('模型条目更新失败')
  return row
}

export function deleteModel(id: string): Promise<void> {
  return query('DELETE FROM ai_models WHERE id = $1', [id]).then(() => undefined)
}

/** 设默认：用途相交的其他默认条目清除（数组列无法做部分唯一索引，应用层保证）。 */
export async function clearDefaults(purposes: string[], exceptId?: string): Promise<void> {
  await query(
    `UPDATE ai_models SET is_default = false, updated_at = now()
     WHERE purposes && $1 AND is_default AND status = 'active'
       AND ($2::text IS NULL OR id <> $2)`,
    [purposes, exceptId ?? null],
  )
}

export function listBindings(): Promise<BindingRow[]> {
  return query<BindingRow>('SELECT * FROM ai_task_bindings ORDER BY task')
}

export function findBinding(task: string): Promise<BindingRow | null> {
  return queryOne<BindingRow>('SELECT * FROM ai_task_bindings WHERE task = $1', [task])
}

export async function upsertBinding(input: {
  task: string
  primaryModelId: string
  backupModelId: string | null
}): Promise<BindingRow> {
  const row = await queryOne<BindingRow>(
    `INSERT INTO ai_task_bindings (task, primary_model_id, backup_model_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (task) DO UPDATE
       SET primary_model_id = EXCLUDED.primary_model_id,
           backup_model_id = EXCLUDED.backup_model_id,
           updated_at = now()
     RETURNING *`,
    [input.task, input.primaryModelId, input.backupModelId],
  )
  if (!row) throw new Error('任务绑定写入失败')
  return row
}
