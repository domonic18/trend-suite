import {
  createMediaAssetRequest,
  createMediaAssetResponse,
  mediaAssetListResponse,
  workbenchRoles,
} from '@trend-suite/contracts'
import { createAsset, listAssets } from '@/server/pipeline/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req, workbenchRoles)
    // courseId 省略即素材库的全局视角：教师名下所有课程的素材。
    const courseId = new URL(req.url).searchParams.get('courseId')
    const items = await listAssets(user, courseId ?? undefined)
    return json(mediaAssetListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const raw = await req.json().catch(() => null)
    const parsed = createMediaAssetRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const created = await createAsset(user, parsed.data)
    return json(createMediaAssetResponse.parse(created), 201)
  } catch (err) {
    return errorResponse(err)
  }
}
