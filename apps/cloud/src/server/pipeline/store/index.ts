import 'server-only'
import { join } from 'node:path'
import { getEnv } from '@/env'
import { CosMediaStore } from './cos'
import { LocalMediaStore } from './local'
import type { MediaStore } from './types'

let cached: MediaStore | undefined

/**
 * 媒体存储实现按 env 装配（arch/05 §3.2）：接口不变，切换只换实现。
 * local 模式默认落 apps/cloud/workspace/media（本地开发）或 /media（容器）。
 */
export function getMediaStore(): MediaStore {
  if (cached) return cached
  const env = getEnv()
  if (env.MEDIA_STORAGE === 'cos') {
    cached = CosMediaStore.fromEnv()
    return cached
  }
  const root =
    env.MEDIA_LOCAL_DIR ??
    (env.APP_ENV === 'local' ? join(process.cwd(), 'workspace/media') : '/media')
  cached = new LocalMediaStore(root)
  return cached
}

export { CosMediaStore } from './cos'
export { LocalMediaStore } from './local'
export type { MediaProbe, MediaStore, UploadTarget } from './types'
