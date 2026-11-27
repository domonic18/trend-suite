import {
  createMarketSourceRequest,
  marketQuoteSourceListResponse,
  marketQuoteSourceView,
  opsReadRoles,
} from '@trend-suite/contracts'
import {
  assertCanWriteMarketSources,
  createMarketSource,
  listMarketSources,
} from '@/server/content/quotes/sources/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 行情源条目列表：运营只读，管理员可写（与模型配置同一权限口径）。 */
export async function GET(req: Request) {
  try {
    await requireUser(req, opsReadRoles)
    const items = await listMarketSources()
    return json(marketQuoteSourceListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req, opsReadRoles)
    assertCanWriteMarketSources(actor.role)
    const raw = await req.json().catch(() => null)
    const parsed = createMarketSourceRequest.safeParse(raw)
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const item = await createMarketSource(parsed.data)
    return json({ item: marketQuoteSourceView.parse(item) }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
