import 'server-only'
import {
  MAX_MEDIA_BYTES,
  type JobStatus,
  type MediaAssetView,
  type MediaUploadTarget,
  type SessionUser,
} from '@trend-suite/contracts'
import { getCourseForUser } from '@/server/content/service'
import { badRequest, HttpError, notFound, unprocessableMedia, unsupportedMediaType } from '@/server/lib/http'
import { queryOne } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { getEnv } from '@/env'
import { ProbeUnavailableError } from './probe'
import * as repo from './repo'
import { cancelJob, findJobByAsset, listLatestJobs } from './jobs/repo'
import { getMediaStore } from './store'
import {
  signUploadToken,
  uploadSha256HeaderName,
  uploadTokenHeaderName,
  verifyUploadToken,
} from './upload-token'

const UPLOAD_CONTENT_TYPE = 'application/octet-stream'

function toAssetView(row: repo.MediaAssetRow, jobStatus: JobStatus | null = null): MediaAssetView {
  return {
    id: row.id,
    courseId: row.course_id,
    fileName: row.original_name ?? '',
    status: row.status as MediaAssetView['status'],
    byteSize: row.byte_size === null ? null : Number(row.byte_size),
    sha256: row.sha256,
    durationS: row.duration_s === null ? null : Number(row.duration_s),
    videoOk: row.video_ok,
    audioOk: row.audio_ok,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    processStep: row.process_step as MediaAssetView['processStep'],
    processProgress: Number(row.process_progress),
    processMessage: row.process_message,
    jobStatus,
    segmentCount: row.segment_count,
    frameCount: row.frame_count,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * 建素材并签发直传凭据（arch/05 §3.1）。
 * 同课程、同名、同大小的待上传素材直接复用——重试不产生重复素材。
 */
export async function createAsset(
  user: SessionUser,
  input: { courseId: string; fileName: string; byteSize: number; sha256?: string | undefined },
): Promise<{ asset: MediaAssetView; upload: MediaUploadTarget }> {
  await getCourseForUser(user, input.courseId)

  const reusable = await repo.findReusableAsset({
    courseId: input.courseId,
    fileName: input.fileName,
    expectedByteSize: input.byteSize,
  })
  const sameDigest =
    reusable !== null &&
    (reusable.expected_sha256 ?? null) === (input.sha256 ?? null)

  const row =
    reusable && sameDigest
      ? reusable
      : await repo.insertAsset({
          id: newId('mediaAsset'),
          courseId: input.courseId,
          fileName: input.fileName,
          expectedByteSize: input.byteSize,
          expectedSha256: input.sha256,
        })

  // 复用即重开有效期：重试要拿到新凭据，不能抱着上一次签发时的到期点。
  const expiresAt =
    reusable && sameDigest ? await repo.refreshUploadExpiry(row.id) : await expiryOf(row)

  return { asset: toAssetView(row), upload: uploadTargetFor(row, expiresAt) }
}

export async function listAssets(
  user: SessionUser,
  courseId: string,
): Promise<MediaAssetView[]> {
  await getCourseForUser(user, courseId)
  const rows = await repo.listAssetsByCourse(courseId)
  const jobs = await listLatestJobs(rows.map((row) => row.id))
  return rows.map((row) => toAssetView(row, jobs.get(row.id)?.status ?? null))
}

/**
 * 接收直传字节（本地模式：字节边收边落盘，不在内存里攒全量）。
 * 顺序：验签 → 类型 → 字节数 → 摘要 → 媒体校验 → 原子提交 → 落库。
 * 任一步不过都清半成品：字节删掉，素材行删掉，列表里不留残骸。
 */
export async function receiveUpload(
  user: SessionUser,
  assetId: string,
  req: Request,
): Promise<MediaAssetView> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  const contentType = (req.headers.get('content-type') ?? '').split(';')[0]?.trim()
  if (contentType !== UPLOAD_CONTENT_TYPE) {
    throw unsupportedMediaType(`直传内容类型必须是 ${UPLOAD_CONTENT_TYPE}`)
  }

  const expectedByteSize = row.expected_byte_size === null ? null : Number(row.expected_byte_size)
  if (expectedByteSize === null) {
    throw badRequest('素材缺少字节数声明')
  }
  const expiresAt = await expiryOf(row)
  const token = req.headers.get(uploadTokenHeaderName()) ?? ''
  verifyUploadToken({
    assetId: row.id,
    byteSize: expectedByteSize,
    sha256: row.expected_sha256 ?? undefined,
    expiresAt,
    token,
  })

  const body = req.body
  if (!body) throw badRequest('上传内容为空')

  const store = getMediaStore()
  const declaredSha = req.headers.get(uploadSha256HeaderName()) ?? undefined

  let received: { byteSize: number; sha256: string }
  try {
    received = await store.receiveUpload({
      assetId: row.id,
      body,
      maxBytes: MAX_MEDIA_BYTES,
      declaredBytes: expectedByteSize,
      sha256: declaredSha,
    })
  } catch (err) {
    await store.discard(row.id)
    throw err
  }

  if (received.byteSize !== expectedByteSize) {
    await store.discard(row.id)
    throw badRequest(
      `上传字节数与声明不符（声明 ${expectedByteSize}，实到 ${received.byteSize}），请重试`,
    )
  }

  let probe
  try {
    probe = await store.probe(row.id)
  } catch (err) {
    await store.remove(row.id)
    await repo.deleteAsset(row.id)
    if (err instanceof ProbeUnavailableError) {
      throw new HttpError(503, 'internal_error', '媒体校验不可用：服务端缺少 ffprobe')
    }
    throw err
  }

  const maxSeconds = getEnv().PIPELINE_MAX_SOURCE_SECONDS
  const reason = probeReason(probe, maxSeconds)
  if (reason) {
    await store.remove(row.id)
    await repo.deleteAsset(row.id)
    throw unprocessableMedia(reason)
  }

  await store.commit(row.id)
  const updated = await repo.markUploaded(row.id, {
    byteSize: received.byteSize,
    sha256: received.sha256,
    durationS: probe.durationS,
    videoOk: probe.videoOk,
    audioOk: probe.audioOk,
    sourcePath: store.sourceRef(row.id),
  })
  return toAssetView(updated)
}

/**
 * 删除素材（教师端需求 T20）：行、段落、关键帧、任务与已落盘字节一并清理。
 * 正在加工的先停；已产出理解成果的不可删——课程内容可能引用它，避免悬空。
 */
export async function deleteMaterial(user: SessionUser, assetId: string): Promise<void> {
  const row = await repo.findAssetById(assetId)
  if (!row) throw notFound('素材不存在')
  await getCourseForUser(user, row.course_id)

  if (await hasSourceUnits(assetId)) {
    throw new HttpError(409, 'material_referenced', '素材已产出理解成果，先处置方案引用再删除')
  }

  const job = await findJobByAsset({ assetId, kind: 'ingest' })
  if (job && (job.status === 'queued' || job.status === 'running')) {
    await cancelJob(job.id)
  }

  await getMediaStore().remove(assetId)
  await repo.deleteAsset(assetId)
}

/** 理解成果表尚未落建（后续迭代）；落建后这里自然生效，不误删。 */
async function hasSourceUnits(assetId: string): Promise<boolean> {
  const t = await queryOne<{ reg: string | null }>(
    `SELECT to_regclass('public.source_units') AS reg`,
  )
  if (!t?.reg) return false
  const r = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM source_units WHERE asset_id = $1`,
    [assetId],
  )
  return Number(r?.n ?? 0) > 0
}

function probeReason(
  probe: { videoOk: boolean; audioOk: boolean; durationS: number | null },
  maxSeconds: number,
): string | null {
  if (!probe.videoOk) return '文件里没有视频流，不是可用的课程录像'
  if (!probe.audioOk) return '文件没有音频轨，转写无法开始；换一个带音轨的版本'
  if (probe.durationS === null) return '读不出媒体时长，文件可能已损坏'
  if (probe.durationS > maxSeconds) {
    return `媒体时长超过上限（${maxSeconds} 秒 / ${maxSeconds / 3600} 小时）`
  }
  return null
}

function uploadTargetFor(row: repo.MediaAssetRow, expiresAt: Date): MediaUploadTarget {
  const byteSize = row.expected_byte_size === null ? 0 : Number(row.expected_byte_size)
  const target = getMediaStore().uploadTarget({
    assetId: row.id,
    byteSize,
    sha256: row.expected_sha256 ?? undefined,
    expiresAt,
  })
  const headers: Record<string, string> = {
    ...target.headers,
    [uploadTokenHeaderName()]: signUploadToken({
      assetId: row.id,
      byteSize,
      sha256: row.expected_sha256 ?? undefined,
      expiresAt,
    }),
  }
  if (row.expected_sha256) headers[uploadSha256HeaderName()] = row.expected_sha256
  return { method: 'PUT', url: target.url, headers, expiresAt: expiresAt.toISOString() }
}

/**
 * 直传凭据到期点：只从库里读，签发与校验读同一行才算得出同一个值。
 * 老素材行没有这列时补写一次。
 */
async function expiryOf(row: repo.MediaAssetRow): Promise<Date> {
  if (row.upload_expires_at !== null) return row.upload_expires_at
  return repo.refreshUploadExpiry(row.id)
}
