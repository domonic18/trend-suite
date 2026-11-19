import { readFile } from 'node:fs/promises'
import { verifyFigureSignature } from '@/server/content/textbook/figure-url'
import { findFigureById } from '@/server/content/textbook/repo'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * generated 图示成图：地址带短时签名（scope='figure'），不走会话头。
 * 仅图示库登记过的 generated 行可取；diagram 走内联 SVG、keyframe 走帧通道。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ figureId: string }> },
) {
  try {
    const { figureId } = await ctx.params
    const url = new URL(req.url)
    verifyFigureSignature({
      figureId,
      exp: url.searchParams.get('exp'),
      sig: url.searchParams.get('sig'),
    })
    const figure = await findFigureById(figureId)
    if (!figure || figure.kind !== 'generated' || !figure.path) {
      return json({ error: { code: 'not_found', message: '图示不存在' } }, 404)
    }
    const bytes = await readFile(figure.path)
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
