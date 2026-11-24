import { updateCourseRequest, workbenchRoles } from '@trend-suite/contracts'
import { deleteCourse, renameCourse } from '@/server/content/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const raw = await req.json().catch(() => null)
    const parsed = updateCourseRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const course = await renameCourse(user, id, parsed.data.title)
    return json({ course })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    await deleteCourse(user, id)
    return new Response(null, { status: 204 })
  } catch (err) {
    return errorResponse(err)
  }
}
