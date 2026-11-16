import { readFile } from 'node:fs/promises'
import { verifyFrameSignature } from '@/server/pipeline/processing/frame-url'
import { findFrameFile } from '@/server/pipeline/processing/service'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 关键帧图片：地址带短时签名，不走会话头（浏览器 <img src> 带不上）。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; frameId: string }> },
) {
  try {
    const { id, frameId } = await ctx.params
    const url = new URL(req.url)
    verifyFrameSignature({
      assetId: id,
      frameId,
      exp: url.searchParams.get('exp'),
      sig: url.searchParams.get('sig'),
    })
    const file = await findFrameFile({ assetId: id, frameId })
    if (!file) return json({ error: { code: 'not_found', message: '关键帧不存在' } }, 404)
    const bytes = await readFile(file.path)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'image/jpeg',
        'cache-control': 'private, max-age=600',
      },
    })
  } catch (err) {
    return errorResponse(err)
  }
}
