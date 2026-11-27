import { modelEntryView, updateModelEntryRequest, opsReadRoles } from '@trend-suite/contracts'
import {
  assertCanWriteModels,
  deleteModelEntry,
  listModelEntries,
  updateModelEntry,
} from '@/server/models/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json, notFound } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(req, opsReadRoles)
    const { id } = await ctx.params
    const item = (await listModelEntries()).find((entry) => entry.id === id)
    if (!item) throw notFound('模型条目不存在')
    return json({ item: modelEntryView.parse(item) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, opsReadRoles)
    assertCanWriteModels(actor.role)
    const { id } = await ctx.params
    const raw = await req.json().catch(() => null)
    const parsed = updateModelEntryRequest.safeParse(raw)
    if (!parsed.success) throw badRequest('参数不合法', firstIssueOf(parsed.error))
    const item = await updateModelEntry(id, parsed.data)
    return json({ item: modelEntryView.parse(item) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(req, opsReadRoles)
    assertCanWriteModels(actor.role)
    const { id } = await ctx.params
    await deleteModelEntry(id)
    return json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
