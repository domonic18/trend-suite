import type { MediaAssetView, ProcessingStep } from '@trend-suite/contracts'

/** 加工阶段顺序与展示名（arch/05 §3.7 的阶段序列）。 */
export const STEP_LABELS: Record<ProcessingStep, string> = {
  uploaded: '上传',
  audio: '抽音频',
  transcribe: 'ASR 转写',
  transcode: '转码',
  frames: '关键帧',
  understand: '理解',
  index: '索引',
  done: '就绪',
}

export const STEP_ORDER: ProcessingStep[] = [
  'uploaded',
  'audio',
  'transcribe',
  'transcode',
  'frames',
  'understand',
  'index',
  'done',
]

/** 就绪度：排队 / 处理中 / 就绪 / 已停止 / 失败。 */
export type Readiness = 'queued' | 'running' | 'ready' | 'stopped' | 'failed'

export function readinessOf(asset: MediaAssetView): Readiness {
  if (asset.jobStatus === 'queued') return 'queued'
  if (asset.jobStatus === 'canceled') return 'stopped'
  if (asset.jobStatus === 'failed' || asset.status === 'failed') return 'failed'
  if (asset.jobStatus === 'succeeded' || asset.status === 'ready' || asset.processStep === 'done') {
    return 'ready'
  }
  return 'running'
}

export const READINESS_TEXT: Record<Readiness, string> = {
  queued: '排队中',
  running: '加工中',
  ready: '转写完成',
  stopped: '已停止',
  failed: '失败',
}

/** 理解段产出的条数：0 = 还没跑理解（智能规划与出处匹配都用不了）。 */
export function understandingCountOf(asset: MediaAssetView): number {
  return asset.stages.find((stage) => stage.stage === 'understanding')?.count ?? 0
}

/**
 * 能不能参与规划：加工完成 + 理解有产出。
 * 只转写没理解 = 没有教学要点可比，勾了也规划不出东西。
 */
export function planningReadyOf(asset: MediaAssetView): boolean {
  return readinessOf(asset) === 'ready' && understandingCountOf(asset) > 0
}

/** 毫秒 → HH:MM:SS。 */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
