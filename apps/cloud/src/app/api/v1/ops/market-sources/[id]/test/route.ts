import { marketSourceTestResultView } from '@trend-suite/contracts'
import { assertCanWriteMarketSources, testMarketSource } from '@/server/content/quotes/sources/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 连通性测试：与正式调用走同一客户端分支（fetchQuotes）。
 * 测试请求真实发往行情源，拉一只样本股票的日线。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, ['operator', 'admin'])
    assertCanWriteMarketSources(actor.role)
    const { id } = await ctx.params
    const result = await testMarketSource(id)
    return json({ result: marketSourceTestResultView.parse(result) })
  } catch (err) {
    return errorResponse(err)
  }
}
