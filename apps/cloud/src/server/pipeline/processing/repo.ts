import 'server-only'
import { query, queryOne, withTransaction } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'

/**
 * 加工产物落库（arch/05 §3.5–§3.6）：
 * - 逐字稿段落按块增量落库，重跑跳过已转块（不重复计费）。
 * - 关键帧按 (asset_id, at_ms) 唯一，重跑只刷新不重复。
 */

export type TranscriptSegmentRow = {
  id: string
  asset_id: string
  seq: number
  start_ms: number
  end_ms: number
  speaker: string | null
  text: string
  unit_id: string | null
  partial: boolean
  chunk_index: number
  created_at: Date
}

const SEGMENT_COLUMNS = [
  'id',
  'asset_id',
  'seq',
  'start_ms',
  'end_ms',
  'speaker',
  'text',
  'unit_id',
  'partial',
  'chunk_index',
  'created_at',
].join(', ')

export type MediaFrameRow = {
  id: string
  asset_id: string
  at_ms: number
  path: string
  width: number | null
  height: number | null
  caption: string | null
  created_at: Date
}

const FRAME_COLUMNS = [
  'id',
  'asset_id',
  'at_ms',
  'path',
  'width',
  'height',
  'caption',
  'created_at',
].join(', ')

/** 已经转完的块序号：重跑时跳过这些块。 */
export async function completedChunkIndexes(assetId: string): Promise<Set<number>> {
  const rows = await query<{ chunk_index: number }>(
    `SELECT DISTINCT chunk_index FROM transcript_segments WHERE asset_id = $1`,
    [assetId],
  )
  return new Set(rows.map((r) => r.chunk_index))
}

export function listSegments(assetId: string): Promise<TranscriptSegmentRow[]> {
  return query<TranscriptSegmentRow>(
    `SELECT ${SEGMENT_COLUMNS} FROM transcript_segments WHERE asset_id = $1 ORDER BY seq ASC`,
    [assetId],
  )
}

export function countSegments(assetId: string): Promise<number> {
  return queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM transcript_segments WHERE asset_id = $1`,
    [assetId],
  ).then((row) => (row ? Number(row.count) : 0))
}

/**
 * 落一块的段落（单事务）：seq 由调用方给定（块内基址 + 序），
 * 全部块转完后统一重排成连续序号。
 * partial=true 表示转写还在进行中。
 */
export async function insertChunkSegments(input: {
  assetId: string
  chunkIndex: number
  segments: { seq: number; startMs: number; endMs: number; text: string; speaker: string | null }[]
}): Promise<number> {
  if (input.segments.length === 0) return 0
  return withTransaction(async (client) => {
    let written = 0
    for (const segment of input.segments) {
      await client.query(
        `INSERT INTO transcript_segments
           (id, asset_id, seq, start_ms, end_ms, speaker, text, partial, chunk_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         ON CONFLICT (asset_id, seq) DO NOTHING`,
        [
          newId('transcriptSegment'),
          input.assetId,
          segment.seq,
          segment.startMs,
          segment.endMs,
          segment.speaker,
          segment.text,
          input.chunkIndex,
        ],
      )
      written += 1
    }
    return written
  })
}

/** 按给定顺序把段落重排成连续序号（单事务）。先压负基址，避免中途撞 (asset_id, seq) 唯一约束。 */
export async function renumber(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await withTransaction(async (client) => {
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE transcript_segments SET seq = $2 - 2147483647 WHERE id = $1`, [
        ids[i],
        i,
      ])
    }
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(`UPDATE transcript_segments SET seq = $2 WHERE id = $1`, [ids[i], i])
    }
  })
}

/** 转写收尾：所有段落定稿（partial=false）。 */
export async function finalizeSegments(assetId: string): Promise<void> {
  await query(`UPDATE transcript_segments SET partial = false WHERE asset_id = $1`, [assetId])
}

/** 强制重转前清空旧段落。 */
export async function clearSegments(assetId: string): Promise<void> {
  await query(`DELETE FROM transcript_segments WHERE asset_id = $1`, [assetId])
}

export function listFrames(assetId: string): Promise<MediaFrameRow[]> {
  return query<MediaFrameRow>(
    `SELECT ${FRAME_COLUMNS} FROM media_frames WHERE asset_id = $1 ORDER BY at_ms ASC`,
    [assetId],
  )
}

export function findFrame(input: {
  assetId: string
  frameId: string
}): Promise<MediaFrameRow | null> {
  return queryOne<MediaFrameRow>(
    `SELECT ${FRAME_COLUMNS} FROM media_frames WHERE id = $1 AND asset_id = $2`,
    [input.frameId, input.assetId],
  )
}

export async function countFrames(assetId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT count(*)::text AS count FROM media_frames WHERE asset_id = $1`,
    [assetId],
  )
  return row ? Number(row.count) : 0
}

/** 关键帧落库：同一时间点只留一张（重跑刷新路径与尺寸）。 */
export async function upsertFrames(input: {
  assetId: string
  frames: { atMs: number; path: string; width: number | null; height: number | null }[]
}): Promise<number> {
  if (input.frames.length === 0) return 0
  await withTransaction(async (client) => {
    for (const frame of input.frames) {
      await client.query(
        `INSERT INTO media_frames (id, asset_id, at_ms, path, width, height)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (asset_id, at_ms) DO UPDATE
           SET path = EXCLUDED.path, width = EXCLUDED.width, height = EXCLUDED.height`,
        [
          newId('mediaFrame'),
          input.assetId,
          frame.atMs,
          frame.path,
          frame.width,
          frame.height,
        ],
      )
    }
  })
  return input.frames.length
}

/** 重跑抽帧前清空旧帧。 */
export async function clearFrames(assetId: string): Promise<void> {
  await query(`DELETE FROM media_frames WHERE asset_id = $1`, [assetId])
}

/** 素材加工进度：就绪度面板读它。 */
export async function setAssetProgress(input: {
  assetId: string
  step: string
  progress: number
  message?: string | null
}): Promise<void> {
  await query(
    `UPDATE media_assets
     SET process_step = $2, process_progress = $3, process_message = $4, updated_at = now()
     WHERE id = $1`,
    [input.assetId, input.step, input.progress, input.message ?? null],
  )
}

/**
 * 素材状态机（arch/03 §32）：awaiting_upload → uploaded → processing → ready（失败 failed）。
 * 失败原因落在 error_code / error_message；process_step 保留失败时所在的阶段，不写成非法阶段值。
 */
export async function setAssetStatus(input: {
  assetId: string
  status: 'processing' | 'ready' | 'failed' | 'uploaded'
  errorCode?: string | null
  errorMessage?: string | null
  message?: string | null
  progress?: number
}): Promise<void> {
  await query(
    `UPDATE media_assets
     SET status = $2,
         error_code = $3,
         error_message = $4,
         process_message = COALESCE($5, process_message),
         process_progress = COALESCE($6, process_progress),
         updated_at = now()
     WHERE id = $1`,
    [
      input.assetId,
      input.status,
      input.errorCode ?? null,
      input.errorMessage ?? null,
      input.message ?? null,
      input.progress ?? null,
    ],
  )
}

export async function setAssetCounts(input: {
  assetId: string
  segmentCount: number
  frameCount: number
}): Promise<void> {
  await query(
    `UPDATE media_assets
     SET segment_count = $2, frame_count = $3, updated_at = now()
     WHERE id = $1`,
    [input.assetId, input.segmentCount, input.frameCount],
  )
}

/** HLS 播放入口落列（transcode 阶段收尾）；置 null 表示尚未提升（重跑补齐的依据）。 */
export async function setAssetHlsPath(input: {
  assetId: string
  hlsPath: string | null
}): Promise<void> {
  await query(
    `UPDATE media_assets SET hls_path = $2, updated_at = now() WHERE id = $1`,
    [input.assetId, input.hlsPath],
  )
}

export async function findAssetHlsPath(assetId: string): Promise<string | null> {
  const row = await queryOne<{ hls_path: string | null }>(
    `SELECT hls_path FROM media_assets WHERE id = $1`,
    [assetId],
  )
  return row?.hls_path ?? null
}

// ---------------------------------------------------------------- 理解产物（source_units）

export type SourceUnitRow = {
  id: string
  course_id: string
  asset_id: string
  start_ms: number
  end_ms: number
  text: string
  visual_desc: string | null
  concept_refs: string[]
  extra: Record<string, unknown>
  chunk_index: number
  model_id: string | null
}

const SOURCE_UNIT_COLUMNS = [
  'id',
  'course_id',
  'asset_id',
  'start_ms',
  'end_ms',
  'text',
  'visual_desc',
  'concept_refs',
  'extra',
  'chunk_index',
  'model_id',
].join(', ')

/** 理解完成的块序号：重跑只补缺失块（arch/05 §4 幂等口径）。 */
export async function completedUnderstandChunkIndexes(assetId: string): Promise<Set<number>> {
  const rows = await query<{ chunk_index: number }>(
    `SELECT DISTINCT chunk_index FROM source_units WHERE asset_id = $1`,
    [assetId],
  )
  return new Set(rows.map((r) => r.chunk_index))
}

/**
 * 落一个理解块（单事务）：单元按 (asset_id, start_ms) 幂等去重，
 * 同事务把落在单元时间窗内的转写段落回填 unit_id。
 */
export async function insertSourceUnits(input: {
  courseId: string
  assetId: string
  chunkIndex: number
  modelId: string | null
  units: {
    startMs: number
    endMs: number
    text: string
    visualDesc: string | null
    conceptRefs: string[]
    chartType: string | null
    teachingPoints: string[]
    frameIds: string[]
  }[]
}): Promise<number> {
  if (input.units.length === 0) return 0
  return withTransaction(async (client) => {
    let written = 0
    for (const unit of input.units) {
      const id = newId('sourceUnit')
      await client.query(
        `INSERT INTO source_units
           (id, course_id, asset_id, start_ms, end_ms, text, visual_desc, concept_refs, extra, chunk_index, model_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
         ON CONFLICT (asset_id, start_ms) DO NOTHING`,
        [
          id,
          input.courseId,
          input.assetId,
          unit.startMs,
          unit.endMs,
          unit.text,
          unit.visualDesc,
          unit.conceptRefs,
          JSON.stringify({ chartType: unit.chartType, teachingPoints: unit.teachingPoints, frameIds: unit.frameIds }),
          input.chunkIndex,
          input.modelId,
        ],
      )
      await client.query(
        `UPDATE transcript_segments
         SET unit_id = $2
         WHERE asset_id = $1 AND unit_id IS NULL
           AND ((start_ms + end_ms) / 2) BETWEEN $3 AND $4`,
        [input.assetId, id, unit.startMs, unit.endMs],
      )
      written += 1
    }
    return written
  })
}

export function listSourceUnitsByAsset(assetId: string): Promise<SourceUnitRow[]> {
  return query<SourceUnitRow>(
    `SELECT ${SOURCE_UNIT_COLUMNS} FROM source_units WHERE asset_id = $1 ORDER BY start_ms ASC`,
    [assetId],
  )
}

export function listSourceUnitsByCourse(courseId: string): Promise<SourceUnitRow[]> {
  return query<SourceUnitRow>(
    `SELECT ${SOURCE_UNIT_COLUMNS} FROM source_units WHERE course_id = $1 ORDER BY asset_id, start_ms ASC`,
    [courseId],
  )
}

export function findSourceUnitsByIds(ids: string[]): Promise<SourceUnitRow[]> {
  if (ids.length === 0) return Promise.resolve([])
  return query<SourceUnitRow>(
    `SELECT ${SOURCE_UNIT_COLUMNS} FROM source_units WHERE id = ANY($1::text[]) ORDER BY start_ms ASC`,
    [ids],
  )
}

/** 课程内每个证据单元的要点条数：算素材覆盖率用（不取正文，省流量）。 */
export function listSourceUnitPointsByCourse(
  courseId: string,
): Promise<{ id: string; points: string[] }[]> {
  return query<{ id: string; points: string[] }>(
    `SELECT id, COALESCE(extra->'teachingPoints', '[]'::jsonb) AS points
       FROM source_units WHERE course_id = $1`,
    [courseId],
  )
}

/** 每个素材的理解产出条数（单元数 + 要点数）：规划页给教师看「这份素材有多少可规划的知识点」。 */
export function listUnitCountsByCourse(
  courseId: string,
): Promise<{ asset_id: string; unit_count: number; point_count: number }[]> {
  return query<{ asset_id: string; unit_count: number; point_count: number }>(
    `SELECT asset_id,
            COUNT(*)::int AS unit_count,
            COALESCE(SUM(CASE WHEN jsonb_typeof(extra->'teachingPoints') = 'array'
                              THEN jsonb_array_length(extra->'teachingPoints') ELSE 0 END), 0)::int AS point_count
       FROM source_units
      WHERE course_id = $1
      GROUP BY asset_id`,
    [courseId],
  )
}
