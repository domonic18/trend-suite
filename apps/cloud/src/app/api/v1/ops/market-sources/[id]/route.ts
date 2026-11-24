import { marketQuoteSourceView, updateMarketSourceRequest } from '@trend-suite/contracts'
import {
  assertCanWriteMarketSources,
  deleteMarketSource,
  updateMarketSource,
} from '@/server/content/quotes/sources/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, ['operator', 'admin'])
    assertCanWriteMarketSources(actor.role)
    const { id } = await ctx.params
    const raw = await req.json().catch(() => null)
    const parsed = updateMarketSourceRequest.safeParse(raw)
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const item = await updateMarketSource(id, parsed.data)
    return json({ item: marketQuoteSourceView.parse(item) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, ['operator', 'admin'])
    assertCanWriteMarketSources(actor.role)
    const { id } = await ctx.params
    await deleteMarketSource(id)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
