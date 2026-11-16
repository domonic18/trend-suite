import { transcriptResponse, workbenchRoles } from '@trend-suite/contracts'
import { getTranscript } from '@/server/pipeline/processing/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 逐字稿：转写进行中也返回已落库的段落（partial=true），可以边转边读。 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req, workbenchRoles)
    const { id } = await ctx.params
    const transcript = await getTranscript(user, id)
    return json(transcriptResponse.parse(transcript))
  } catch (err) {
    return errorResponse(err)
  }
}
