import { readFile, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { rewritePlaylist, verifyHlsSignature } from '@/server/pipeline/processing/hls-url'
import { getMediaStore } from '@/server/pipeline/store'
import { errorResponse, notFound } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * playlist + 分片统一入口（arch/05 §3.3）：地址带短时签名（覆盖 hls/<assetId>
 * 前缀），playlist 回体前把签名查询串补写进每个分片行（hls.js 解析相对地址会丢
 * base 的 query）。落盘路径结构性锁死在 store.hlsDir 内——不存在任何路径能借此
 * 触达 sources/。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await ctx.params
    const assetId = path[0]
    const file = path.slice(1).join('/')
    if (!assetId || file === '') return notFound('HLS 路径不完整')

    const url = new URL(req.url)
    const exp = url.searchParams.get('exp')
    const sig = url.searchParams.get('sig')
    verifyHlsSignature({ assetId, exp, sig })

    const store = getMediaStore()
    const baseDir = resolve(store.hlsDir(assetId))
    const filePath = resolve(baseDir, file)
    if (filePath !== baseDir && !filePath.startsWith(baseDir + sep)) {
      return notFound('HLS 文件不存在')
    }
    const info = await stat(filePath).catch(() => null)
    if (!info || !info.isFile()) return notFound('HLS 文件不存在')

    if (file.endsWith('.m3u8')) {
      const playlist = await readFile(filePath, 'utf8')
      return new Response(rewritePlaylist(playlist, exp!, sig!), {
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'cache-control': 'private, no-store',
        },
      })
    }
    const bytes = await readFile(filePath)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': file.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream',
        'cache-control': 'private, max-age=600',
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}
