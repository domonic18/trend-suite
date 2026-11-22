import 'server-only'
import type { JobStatus, MediaAssetStageView, MediaAssetView } from '@trend-suite/contracts'
import * as repo from './repo'
import { stageViewsOf } from './stages'

/**
 * 素材视图的拼装（视图层字段不落库，改了即时反映）：
 * - courseTitle：归属课程标题——素材库是跨课程视角，教师要看得出素材属于哪门课；
 * - stages：逐字稿 / 关键帧 / 视频理解三段各自的状态与产出条数。
 */

/** 纯拼装：给定三段与课程标题，组装出素材视图。 */
export function buildAssetView(
  row: repo.MediaAssetRow,
  input: {
    jobStatus?: JobStatus | null
    courseTitle?: string | null
    stages?: MediaAssetStageView[]
  } = {},
): MediaAssetView {
  return {
    id: row.id,
    courseId: row.course_id,
    courseTitle: input.courseTitle ?? null,
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
    jobStatus: input.jobStatus ?? null,
    segmentCount: row.segment_count,
    frameCount: row.frame_count,
    stages: input.stages ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** 单份素材的视图：三段状态与课程标题各查一次。 */
export async function assetViewOf(
  row: repo.MediaAssetRow,
  jobStatus: JobStatus | null = null,
): Promise<MediaAssetView> {
  const [stages, titles] = await Promise.all([
    stageViewsOf([row]),
    repo.listCourseTitles([row.course_id]),
  ])
  return buildAssetView(row, {
    jobStatus,
    courseTitle: titles.get(row.course_id) ?? null,
    stages: stages.get(row.id) ?? [],
  })
}

/** 一批素材的视图：状态与标题各查一次，不逐条打库。 */
export async function assetViewsOf(
  rows: repo.MediaAssetRow[],
  jobs: Map<string, { status: JobStatus }>,
): Promise<MediaAssetView[]> {
  const [stages, titles] = await Promise.all([
    stageViewsOf(rows),
    repo.listCourseTitles([...new Set(rows.map((row) => row.course_id))]),
  ])
  return rows.map((row) =>
    buildAssetView(row, {
      jobStatus: jobs.get(row.id)?.status ?? null,
      courseTitle: titles.get(row.course_id) ?? null,
      stages: stages.get(row.id) ?? [],
    }),
  )
}
