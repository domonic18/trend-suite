import type { MediaAssetStageView, MediaAssetView, MediaStage } from '@trend-suite/contracts'

/**
 * 素材三段的前端口径（教师端需求 T4b）。
 *
 * 纯函数：段名、段态的视觉口径、产出条数的说法都在这里，
 * 组件只渲染。
 */

/** 段名：逐字稿 / 关键帧 / 视频理解。 */
export const STAGE_LABELS: Record<MediaStage, string> = {
  transcript: '逐字稿',
  frames: '关键帧',
  understanding: '视频理解',
}

/** 三段的固定顺序：先转写，再抽帧，最后理解（依赖关系即顺序）。 */
export const STAGE_ORDER: MediaStage[] = ['transcript', 'frames', 'understanding']

/** 段态 → 视觉口吻：空闲 / 进行中 / 完成 / 有缺口 / 失败。 */
export type StageTone = 'idle' | 'run' | 'done' | 'warn' | 'err'

export function stageTone(status: MediaAssetStageView['status']): StageTone {
  if (status === 'running') return 'run'
  if (status === 'done') return 'done'
  if (status === 'partial') return 'warn'
  if (status === 'failed') return 'err'
  return 'idle'
}

/** 取素材的某一段视图；旧数据没有 stages 字段时按「空」兜底。 */
export function stageViewOf(
  asset: MediaAssetView,
  stage: MediaStage,
): MediaAssetStageView {
  const found = asset.stages.find((item) => item.stage === stage)
  return (
    found ?? {
      stage,
      status: 'empty',
      count: 0,
      updatedAt: null,
      errorMessage: null,
    }
  )
}

/** 产出条数的说法：逐字稿按段、关键帧按张、理解按条讲解要点。 */
export function stageCountText(stage: MediaStage, count: number): string {
  if (stage === 'transcript') return count > 0 ? `${count} 段` : '还没有段落'
  if (stage === 'frames') return count > 0 ? `${count} 张` : '还没有关键帧'
  return count > 0 ? `${count} 条讲解要点` : '还没有理解结果'
}

/** 段态的一句话说明（状态标下方）。 */
export function stageStatusText(stage: MediaStage, view: MediaAssetStageView): string {
  if (view.status === 'running') return '正在生成…'
  if (view.status === 'failed') return '生成失败'
  if (view.status === 'partial') return '未完成，可重跑补齐'
  if (view.status === 'empty') return '未开始'
  return stageCountText(stage, view.count)
}
