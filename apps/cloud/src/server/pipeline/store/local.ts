import 'server-only'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { badRequest, payloadTooLarge } from '@/server/lib/http'
import { probeMedia } from '../probe'
import type { MediaProbe, MediaStore, UploadTarget } from './types'

/**
 * 本地文件系统实现（arch/05 §3.2）：开发与测试用，接口与 COS 一致。
 * 布局：<root>/staging/<assetId>/upload → 校验通过后 rename 到 <root>/sources/<assetId>/source。
 */
export class LocalMediaStore implements MediaStore {
  readonly kind = 'local' as const

  constructor(private readonly root: string) {}

  private stagingPath(assetId: string): string {
    return join(this.root, 'staging', assetId, 'upload')
  }

  private sourcePathOf(assetId: string): string {
    return join(this.root, 'sources', assetId, 'source')
  }

  uploadTarget(input: {
    assetId: string
    byteSize: number
    sha256?: string | undefined
    expiresAt: Date
  }): UploadTarget {
    return {
      method: 'PUT',
      url: `/v1/admin/content/media-assets/${input.assetId}/upload`,
      headers: { 'content-type': 'application/octet-stream' },
      expiresAt: input.expiresAt.toISOString(),
    }
  }

  async receiveUpload(input: {
    assetId: string
    body: ReadableStream<Uint8Array>
    maxBytes: number
    declaredBytes: number
    sha256?: string | undefined
  }): Promise<{ byteSize: number; sha256: string }> {
    const target = this.stagingPath(input.assetId)
    await mkdir(dirname(target), { recursive: true })

    const hash = createHash('sha256')
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length
        if (bytes > input.maxBytes) {
          cb(new PayloadTooLarge())
          return
        }
        if (bytes > input.declaredBytes) {
          cb(new BytesExceedDeclaration())
          return
        }
        hash.update(chunk)
        cb(null, chunk)
      },
    })

    try {
      await pipeline(
        Readable.fromWeb(input.body as import('node:stream/web').ReadableStream),
        meter,
        createWriteStream(target),
      )
    } catch (err) {
      await rm(dirname(target), { recursive: true, force: true })
      if (err instanceof PayloadTooLarge) {
        throw payloadTooLarge(`文件超出上限（最大 ${input.maxBytes} 字节 / 2GiB）`)
      }
      if (err instanceof BytesExceedDeclaration) {
        throw badRequest(`上传字节数超出声明（声明 ${input.declaredBytes} 字节）`)
      }
      throw err
    }

    const digest = hash.digest('hex')
    if (input.sha256 && input.sha256 !== digest) {
      await rm(dirname(target), { recursive: true, force: true })
      throw badRequest('文件摘要与声明不符，已丢弃半成品')
    }
    return { byteSize: bytes, sha256: digest }
  }

  async sourcePath(assetId: string): Promise<string> {
    const staged = this.stagingPath(assetId)
    if (await exists(staged)) return staged
    return this.sourcePathOf(assetId)
  }

  async commit(assetId: string): Promise<void> {
    const staged = this.stagingPath(assetId)
    const target = this.sourcePathOf(assetId)
    await mkdir(dirname(target), { recursive: true })
    await rm(target, { force: true })
    await rename(staged, target)
    await rm(dirname(staged), { recursive: true, force: true })
  }

  sourceRef(assetId: string): string {
    return `sources/${assetId}/source`
  }

  framesDir(assetId: string): string {
    return join(this.root, 'sources', assetId, 'frames')
  }

  hlsDir(assetId: string): string {
    return join(this.root, 'hls', assetId)
  }

  hlsRef(assetId: string): string {
    return `hls/${assetId}/index.m3u8`
  }

  figuresDir(figureId: string): string {
    return join(this.root, 'figures', figureId)
  }

  async probe(assetId: string): Promise<MediaProbe> {
    return probeMedia(await this.sourcePath(assetId))
  }

  async discard(assetId: string): Promise<void> {
    await rm(join(this.root, 'staging', assetId), { recursive: true, force: true })
  }

  async remove(assetId: string): Promise<void> {
    await this.discard(assetId)
    await rm(join(this.root, 'sources', assetId), { recursive: true, force: true })
    await rm(join(this.root, 'hls', assetId), { recursive: true, force: true })
  }

  /** 只删关键帧目录：原片（sources/<id>/source）与 HLS 不动。 */
  async removeFrames(assetId: string): Promise<void> {
    await rm(join(this.root, 'sources', assetId, 'frames'), { recursive: true, force: true })
  }
}

class PayloadTooLarge extends Error {
  constructor() {
    super('文件超出上限')
    this.name = 'PayloadTooLarge'
  }
}

class BytesExceedDeclaration extends Error {
  constructor() {
    super('上传字节数超出声明')
    this.name = 'BytesExceedDeclaration'
  }
}

async function exists(path: string): Promise<boolean> {
  const { stat } = await import('node:fs/promises')
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
