import 'server-only'
import { MEDIA_UPLOAD_TTL_SECONDS } from '@trend-suite/contracts'
import { query, queryOne } from '@/server/lib/db'

export type MediaAssetRow = {
  id: string
  course_id: string
  original_name: string | null
  source_path: string | null
  sha256: string | null
  byte_size: string | null
  duration_s: string | null
  status: string
  hls_path: string | null
  video_ok: boolean
  audio_ok: boolean
  error_code: string | null
  error_message: string | null
  expected_byte_size: string | null
  expected_sha256: string | null
  upload_expires_at: Date | null
  process_step: string
  process_progress: string
  process_message: string | null
  segment_count: number
  frame_count: number
  created_at: Date
  updated_at: Date
}

const COLUMNS = [
  'id',
  'course_id',
  'original_name',
  'source_path',
  'sha256',
  'byte_size',
  'duration_s',
  'status',
  'hls_path',
  'video_ok',
  'audio_ok',
  'error_code',
  'error_message',
  'expected_byte_size',
  'expected_sha256',
  'upload_expires_at',
  'process_step',
  'process_progress',
  'process_message',
  'segment_count',
  'frame_count',
  'created_at',
  'updated_at',
].join(', ')

export async function insertAsset(input: {
  id: string
  courseId: string
  fileName: string
  expectedByteSize: number
  expectedSha256?: string | undefined
}): Promise<MediaAssetRow> {
  const row = await queryOne<MediaAssetRow>(
    `INSERT INTO media_assets (id, course_id, original_name, expected_byte_size, expected_sha256, upload_expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
     RETURNING ${COLUMNS}`,
    [
      input.id,
      input.courseId,
      input.fileName,
      input.expectedByteSize,
      input.expectedSha256 ?? null,
      MEDIA_UPLOAD_TTL_SECONDS,
    ],
  )
  if (!row) throw new Error('素材写入失败')
  return row
}

/**
 * 重开一个直传凭据的有效期。签发与校验必须读到同一个到期点，
 * 所以到期点存在库里而不是各自现算（arch/05 §3.1）。
 */
export async function refreshUploadExpiry(id: string): Promise<Date> {
  const row = await queryOne<{ upload_expires_at: Date }>(
    `UPDATE media_assets
     SET upload_expires_at = now() + make_interval(secs => $2), updated_at = now()
     WHERE id = $1
     RETURNING upload_expires_at`,
    [id, MEDIA_UPLOAD_TTL_SECONDS],
  )
  if (!row) throw new Error('素材更新失败')
  return row.upload_expires_at
}

export function findAssetById(id: string): Promise<MediaAssetRow | null> {
  return queryOne<MediaAssetRow>(`SELECT ${COLUMNS} FROM media_assets WHERE id = $1`, [id])
}

/** 同课程、同名、同大小的待上传素材——重试时复用它，不产生重复素材（教师端需求 T4）。 */
export function findReusableAsset(input: {
  courseId: string
  fileName: string
  expectedByteSize: number
}): Promise<MediaAssetRow | null> {
  return queryOne<MediaAssetRow>(
    `SELECT ${COLUMNS} FROM media_assets
     WHERE course_id = $1 AND original_name = $2 AND expected_byte_size = $3 AND status = 'awaiting_upload'
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.courseId, input.fileName, input.expectedByteSize],
  )
}

export function listAssetsByCourse(courseId: string): Promise<MediaAssetRow[]> {
  return query<MediaAssetRow>(
    `SELECT ${COLUMNS} FROM media_assets WHERE course_id = $1 ORDER BY created_at DESC`,
    [courseId],
  )
}

export async function markUploaded(
  id: string,
  input: {
    byteSize: number
    sha256: string
    durationS: number | null
    videoOk: boolean
    audioOk: boolean
    sourcePath: string
  },
): Promise<MediaAssetRow> {
  const row = await queryOne<MediaAssetRow>(
    `UPDATE media_assets
     SET status = 'uploaded', byte_size = $2, sha256 = $3, duration_s = $4,
         video_ok = $5, audio_ok = $6, source_path = $7,
         error_code = NULL, error_message = NULL, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      input.byteSize,
      input.sha256,
      input.durationS,
      input.videoOk,
      input.audioOk,
      input.sourcePath,
    ],
  )
  if (!row) throw new Error('素材更新失败')
  return row
}

export function deleteAsset(id: string): Promise<void> {
  return query(`DELETE FROM media_assets WHERE id = $1`, [id]).then(() => undefined)
}
