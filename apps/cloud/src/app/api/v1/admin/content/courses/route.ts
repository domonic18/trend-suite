import { createCourseRequest, courseListResponse, createCourseResponse, workbenchRoles } from '@trend-suite/contracts'
import { createCourse, listCourseSummariesFor } from '@/server/content/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const items = await listCourseSummariesFor(user)
    return json(courseListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const raw = await req.json().catch(() => null)
    const parsed = createCourseRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const course = await createCourse(user.id, parsed.data.title)
    return json(createCourseResponse.parse({ course }), 201)
  } catch (err) {
    return errorResponse(err)
  }
}
