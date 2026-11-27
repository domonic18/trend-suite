import {
  taskBindingListResponse,
  updateTaskBindingRequest,
} from '@trend-suite/contracts'
import { assertCanWriteModels, listTaskBindings, updateTaskBinding } from '@/server/models/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 任务槽位绑定：运营只读，管理员可写（arch/07 §9）。 */
export async function GET(req: Request) {
  try {
    await requireUser(req, ['producer', 'operator', 'admin'])
    const items = await listTaskBindings()
    return json(taskBindingListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const actor = await requireUser(req, ['producer', 'operator', 'admin'])
    assertCanWriteModels(actor.role)
    const raw = await req.json().catch(() => null)
    const parsed = updateTaskBindingRequest.safeParse(raw)
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const item = await updateTaskBinding(parsed.data)
    return json({ item })
  } catch (err) {
    return errorResponse(err)
  }
}
