import {
  createModelEntryRequest,
  modelEntryListResponse,
  modelEntryView,
} from '@trend-suite/contracts'
import { assertCanWriteModels, createModelEntry, listModelEntries } from '@/server/models/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 模型条目列表：运营只读，管理员可写（arch/07 §9）。 */
export async function GET(req: Request) {
  try {
    await requireUser(req, ['producer', 'operator', 'admin'])
    const items = await listModelEntries()
    return json(modelEntryListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req, ['producer', 'operator', 'admin'])
    assertCanWriteModels(actor.role)
    const raw = await req.json().catch(() => null)
    const parsed = createModelEntryRequest.safeParse(raw)
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const entry = await createModelEntry(parsed.data)
    return json({ item: modelEntryView.parse(entry) }, 201)
  } catch (err) {
    return errorResponse(err)
  }
}
