import 'server-only'
import {
  mediaStages,
  type MediaAssetStageView,
  type MediaStage,
  type MediaStageStatus,
  type SessionUser,
} from '@trend-suite/contracts'
import { findPlansReferencingUnits } from '@/server/content/plans/repo'
import { getCourseForUser } from '@/server/content/service'
import { conflict, HttpError, notFound } from '@/server/lib/http'
import { findActiveJobByAsset, enqueueJob } from './jobs/repo'
import * as procRepo from './processing/repo'
import * as repo from './repo'
import { listStageStates, setStageState, type StageStateRow } from './stage-repo'
import { getMediaStore } from './store'

/**
 * 素材分析三段（逐字稿 / 关键帧 / 视频理解）的视图与操作。
 *
 * 口径（教师端需求 T4/T4b）：
 * - 三段各自可看状态、单独重跑、单独删除结果；
 * - 重跑默认只补缺口（按块去重，不重复计费），force=true 才清掉该段重来；
 * - 删除某段只删该段产物，素材字节与另外两段不受影响；
 * - 理解结果被方案引用时不可清空——课程内容会悬空（沿用 T20 的引用处置口径）。
 */

/** 段的中文名：提示语与前端标签共用一份。 */
export const STAGE_LABELS: Record<MediaStage, string> = {
  transcript: '逐字稿',
  frames: '关键帧',
  understanding: '视频理解',
}

export type StageStat = { count: number; updatedAt: Date | null }

/**
 * 三段视图的拼装（纯函数，便于单测）。
 *
 * 状态优先取台账（台账记的是「正在跑 / 失败」这类过程事实）；
 * 台账没有记录时按产物条数推导（有条即完成，无条即空）。
 */
export function buildStageViews(input: {
  states?: Map<string, StageStateRow> | undefined
  transcript?: StageStat | undefined
  frames?: StageStat | undefined
  understanding?: StageStat | undefined
}): MediaAssetStageView[] {
  const stats: Record<MediaStage, StageStat> = {
    transcript: input.transcript ?? { count: 0, updatedAt: null },
    frames: input.frames ?? { count: 0, updatedAt: null },
    understanding: input.understanding ?? { count: 0, updatedAt: null },
  }
  return mediaStages.map((stage) => {
    const stat = stats[stage]
    const state = input.states?.get(stage)
    const status = resolveStatus(state, stat)
    const updatedAt = latest(state?.updated_at ?? null, stat.updatedAt)
    return {
      stage,
      status,
      count: stat.count,
      updatedAt: updatedAt ? updatedAt.toISOString() : null,
      errorMessage:
        status === 'failed' || status === 'partial' ? (state?.error_message ?? null) : null,
    }
  })
}

function resolveStatus(
  state: StageStateRow | undefined,
  stat: StageStat,
): MediaStageStatus {
  if (state) {
    if (state.status === 'running' || state.status === 'failed' || state.status === 'partial') {
      return state.status
    }
    if (state.status === 'done') return stat.count > 0 ? 'done' : 'empty'
    return 'empty'
  }
  return stat.count > 0 ? 'done' : 'empty'
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b
  if (!b) return a
  return a.getTime() >= b.getTime() ? a : b
}

/** 一批素材的三段视图。 */
export async function stageViewsOf(
  rows: { id: string }[],
): Promise<Map<string, MediaAssetStageView[]>> {
  const ids = rows.map((row) => row.id)
  const [states, transcript, frames, understanding] = await Promise.all([
    listStageStates(ids),
    procRepo.transcriptStatsByAssets(ids),
    procRepo.frameStatsByAssets(ids),
    procRepo.unitStatsByAssets(ids),
  ])
  const map = new Map<string, MediaAssetStageView[]>()
  for (const row of rows) {
    map.set(
      row.id,
      buildStageViews({
        states: states.get(row.id),
        transcript: transcript.get(row.id),
        frames: frames.get(row.id),
        understanding: understanding.get(row.id),
      }),
    )
  }
  return map
}

/**
 * 重跑某一段：入队一个分段任务，worker 只跑这一段。
 * force=true 先清掉该段已有结果（清空受引用检查约束）。
 */
export async function rerunStage(
  user: SessionUser,
  assetId: string,
  stage: MediaStage,
  force: boolean,
): Promise<{ jobId: string; asset: repo.MediaAssetRow }> {
  const asset = await repo.findAssetById(assetId)
  if (!asset) throw notFound('素材不存在')
  await getCourseForUser(user, asset.course_id)

  if (!asset.source_path || asset.status === 'awaiting_upload') {
    throw conflict('素材尚未上传完成，先完成上传再重跑')
  }
  const active = await findActiveJobByAsset(assetId)
  if (active) {
    throw conflict(
      active.status === 'running'
        ? '素材有任务正在跑，先停止再重跑'
        : '素材有任务在队列中，先停止再重跑',
    )
  }
  await assertStagePrereq(asset, stage)

  if (force) await clearStageOutputs(asset, stage)
  await setStageState({ assetId, stage, status: 'running' })

  const job = await enqueueJob({ assetId, kind: 'media_stage', stage })
  const updated = await repo.findAssetById(assetId)
  return { jobId: job.id, asset: updated ?? asset }
}

/**
 * 删掉某一段的结果：素材字节与另外两段不动。
 * 理解结果被方案引用时拒绝——先处置引用再删。
 */
export async function deleteStage(
  user: SessionUser,
  assetId: string,
  stage: MediaStage,
): Promise<repo.MediaAssetRow> {
  const asset = await repo.findAssetById(assetId)
  if (!asset) throw notFound('素材不存在')
  await getCourseForUser(user, asset.course_id)

  const active = await findActiveJobByAsset(assetId)
  if (active) throw conflict('素材有任务在跑，先停止再删除结果')

  await clearStageOutputs(asset, stage)
  await setStageState({ assetId, stage, status: 'empty' })
  await syncAssetCounts(assetId)
  return (await repo.findAssetById(assetId)) ?? asset
}

/** 某段的运行前提：理解要有逐字稿，其余两段要有原片。 */
async function assertStagePrereq(
  asset: repo.MediaAssetRow,
  stage: MediaStage,
): Promise<void> {
  if (stage !== 'understanding') return
  const segments = await procRepo.countSegments(asset.id)
  if (segments === 0) {
    throw conflict('视频理解需要逐字稿，先重跑逐字稿')
  }
}

/** 清空某一段的产物（删结果与 force 重跑共用同一套清理）。 */
async function clearStageOutputs(
  asset: repo.MediaAssetRow,
  stage: MediaStage,
): Promise<void> {
  if (stage === 'transcript') {
    await procRepo.clearSegments(asset.id)
    return
  }
  if (stage === 'frames') {
    const frames = await procRepo.listFrames(asset.id)
    await procRepo.clearFrames(asset.id)
    await getMediaStore().removeFrames(asset.id)
    await procRepo.detachFrameRefs(
      asset.id,
      frames.map((frame) => frame.id),
    )
    return
  }
  await assertUnderstandingNotReferenced(asset)
  await procRepo.clearSourceUnits(asset.id)
}

/** 理解结果被方案引用时不可清空：课程内容会悬空。 */
async function assertUnderstandingNotReferenced(asset: repo.MediaAssetRow): Promise<void> {
  const unitIds = await procRepo.listSourceUnitIdsByAsset(asset.id)
  if (unitIds.length === 0) return
  const plans = await findPlansReferencingUnits({ unitIds })
  if (plans.length === 0) return
  throw new HttpError(
    409,
    'material_referenced',
    `这份素材的理解结果已被课程方案 v${plans[0]?.version} 引用，先处置引用再删除`,
  )
}

/** 段产物清空后同步素材上的缓存计数。 */
async function syncAssetCounts(assetId: string): Promise<void> {
  const [segmentCount, frameCount] = await Promise.all([
    procRepo.countSegments(assetId),
    procRepo.countFrames(assetId),
  ])
  await procRepo.setAssetCounts({ assetId, segmentCount, frameCount })
}
