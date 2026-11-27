import { asrChannelResponse, opsReadRoles } from '@trend-suite/contracts'
import { getAsrChannel } from '@/server/models/service'
import { requireUser } from '@/server/lib/auth'
import { errorResponse, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** ASR 渠道：素材入库即转写用的那一条配置（密钥只回掩码）。 */
export async function GET(req: Request) {
  try {
    await requireUser(req, opsReadRoles)
    const channel = await getAsrChannel()
    return json(asrChannelResponse.parse({ channel }))
  } catch (err) {
    return errorResponse(err)
  }
}
