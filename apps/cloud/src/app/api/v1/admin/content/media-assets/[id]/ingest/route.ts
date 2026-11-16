import { ingestRequest, ingestResponse, workbenchRoles } from '@trend-suite/contracts'
import { ingestAsset } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 触发加工：入队，worker 认领后跑阶段（arch/05 §3.7）。 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const raw = await req.json().catch(() => ({}))
    const parsed = ingestRequest.safeParse(raw ?? {})
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const result = await ingestAsset(user, id, { force: parsed.data.force })
    return json(ingestResponse.parse(result), 202)
  } catch (err) {
    return errorResponse(err)
  }
}
