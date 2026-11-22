import 'server-only'
import { query } from '@/server/lib/db'

/**
 * 素材三段的状态台账（media_asset_stages）。
 *
 * 只存「状态与失败原因」——产出条数从产物表实时数（transcript_segments /
 * media_frames / source_units），状态与计数各归其位。
 */

export type StageStateRow = {
  asset_id: string
  stage: string
  status: string
  error_message: string | null
  updated_at: Date
}

const COLUMNS = 'asset_id, stage, status, error_message, updated_at'

export async function listStageStates(
  assetIds: string[],
): Promise<Map<string, Map<string, StageStateRow>>> {
  const map = new Map<string, Map<string, StageStateRow>>()
  if (assetIds.length === 0) return map
  const rows = await query<StageStateRow>(
    `SELECT ${COLUMNS} FROM media_asset_stages WHERE asset_id = ANY($1::text[])`,
    [assetIds],
  )
  for (const row of rows) {
    const inner = map.get(row.asset_id) ?? new Map<string, StageStateRow>()
    inner.set(row.stage, row)
    map.set(row.asset_id, inner)
  }
  return map
}

/** 写段状态：同一 (素材, 段) 幂等覆盖。 */
export async function setStageState(input: {
  assetId: string
  stage: string
  status: 'empty' | 'running' | 'done' | 'partial' | 'failed'
  errorMessage?: string | null
}): Promise<void> {
  await query(
    `INSERT INTO media_asset_stages (asset_id, stage, status, error_message, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (asset_id, stage) DO UPDATE
       SET status = EXCLUDED.status,
           error_message = EXCLUDED.error_message,
           updated_at = now()`,
    [input.assetId, input.stage, input.status, input.errorMessage ?? null],
  )
}
