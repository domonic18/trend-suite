import { modelTestResultView } from '@trend-suite/contracts'
import { assertCanWriteModels, testModelEntry } from '@/server/models/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 连通性测试：与正式调用走同一协议分支（arch/07 §9.1）。
 * 测试请求真实发出，会计费。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, ['operator', 'admin'])
    assertCanWriteModels(actor.role)
    const { id } = await ctx.params
    const result = await testModelEntry(id)
    return json({ result: modelTestResultView.parse(result) })
  } catch (err) {
    return errorResponse(err)
  }
}
