import 'server-only'
import { getEnv } from '@/env'
import type { MediaProbe, MediaStore, UploadTarget } from './types'

/**
 * COS 骨架（arch/05 §3.2 定案生产走对象存储）。
 *
 * 2026-11 决定：桶与凭据到位前只留骨架——接口、配置项与装配点就位，
 * 真正启用还差四件事，逐条写在这里，避免后人重踩：
 *   1. 预签名直传：按 SigV4 生成 PUT 预签名 URL（浏览器直传 COS，字节不进应用）；
 *   2. 桶 CORS：允许工作台域名 PUT；
 *   3. probe 取样：把对象下载到管线临时区（/data）再跑 ffprobe；
 *   4. 清理：半成品对象与临时文件都要删。
 *
 * 在此之前任何调用都抛「未启用」，由路由层映射成 503（arch/05 §3.8）。
 */
export class CosMediaStore implements MediaStore {
  readonly kind = 'cos' as const

  constructor(readonly config: CosConfig) {}

  static fromEnv(): CosMediaStore {
    const env = getEnv()
    const missing = (
      [
        ['COS_BUCKET', env.COS_BUCKET],
        ['COS_REGION', env.COS_REGION],
        ['COS_ENDPOINT', env.COS_ENDPOINT],
        ['COS_SECRET_ID', env.COS_SECRET_ID],
        ['COS_SECRET_KEY', env.COS_SECRET_KEY],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name)
    if (missing.length > 0) {
      throw new Error(`COS 未配置完整：缺 ${missing.join('、')}`)
    }
    return new CosMediaStore({
      bucket: env.COS_BUCKET as string,
      region: env.COS_REGION as string,
      endpoint: env.COS_ENDPOINT as string,
      secretId: env.COS_SECRET_ID as string,
      secretKey: env.COS_SECRET_KEY as string,
    })
  }

  uploadTarget(_input: {
    assetId: string
    byteSize: number
    sha256?: string | undefined
    expiresAt: Date
  }): UploadTarget {
    throw new CosNotReadyError()
  }

  async receiveUpload(_input: {
    assetId: string
    body: ReadableStream<Uint8Array>
    maxBytes: number
    declaredBytes: number
    sha256?: string | undefined
  }): Promise<{ byteSize: number; sha256: string }> {
    throw new CosNotReadyError()
  }

  async sourcePath(_assetId: string): Promise<string> {
    throw new CosNotReadyError()
  }

  async commit(_assetId: string): Promise<void> {
    throw new CosNotReadyError()
  }

  sourceRef(assetId: string): string {
    return `sources/${assetId}/source`
  }

  framesDir(_assetId: string): string {
    throw new CosNotReadyError()
  }

  hlsDir(_assetId: string): string {
    throw new CosNotReadyError()
  }

  figuresDir(_figureId: string): string {
    throw new CosNotReadyError()
  }

  hlsRef(assetId: string): string {
    return `hls/${assetId}/index.m3u8`
  }

  async probe(_assetId: string): Promise<MediaProbe> {
    throw new CosNotReadyError()
  }

  async discard(_assetId: string): Promise<void> {
    throw new CosNotReadyError()
  }

  async remove(_assetId: string): Promise<void> {
    throw new CosNotReadyError()
  }

  async removeFrames(_assetId: string): Promise<void> {
    throw new CosNotReadyError()
  }
}

export type CosConfig = {
  bucket: string
  region: string
  endpoint: string
  secretId: string
  secretKey: string
}

export class CosNotReadyError extends Error {
  constructor() {
    super('COS 直传尚未接入')
    this.name = 'CosNotReadyError'
  }
}
