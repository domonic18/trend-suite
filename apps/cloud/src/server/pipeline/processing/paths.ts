import 'server-only'
import { join } from 'node:path'
import { getEnv } from '@/env'

/**
 * 加工工作区（arch/05 §3.4）：每个素材一个目录，跑完即可丢。
 * 容器内落 PIPELINE_WORK_DIR（卷），本地落 apps/cloud/workspace/pipeline。
 */
export function workRoot(): string {
  const env = getEnv()
  if (env.PIPELINE_WORK_DIR) return env.PIPELINE_WORK_DIR
  return env.APP_ENV === 'local' ? join(process.cwd(), 'workspace/pipeline') : '/data/pipeline'
}

/** 单个素材的工作目录：<root>/<assetId>。 */
export function assetWorkDir(assetId: string): string {
  return join(workRoot(), assetId)
}

/** 关键帧目录：<root>/<assetId>/keyframes。 */
export function framesDir(assetId: string): string {
  return join(assetWorkDir(assetId), 'keyframes')
}
