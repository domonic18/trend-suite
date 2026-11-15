import {
  accountListResponse,
  createAccountRequest,
  createAccountResponse,
  type UserRole,
} from '@trend-suite/contracts'
import { createAccount, listAccounts } from '@/server/accounts/service'
import { requireUser } from '@/server/lib/auth'
import { badRequest, errorResponse, firstIssueOf, forbidden, json } from '@/server/lib/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 运营只能建教师与学员账号；运营与管理员账号只有管理员能建（防提权）。 */
const OPERATOR_CREATABLE: readonly UserRole[] = ['producer', 'student']

export async function GET(req: Request) {
  try {
    await requireUser(req, ['operator', 'admin'])
    const items = await listAccounts()
    return json(accountListResponse.parse({ items }))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser(req, ['operator', 'admin'])
    const raw = await req.json().catch(() => null)
    const parsed = createAccountRequest.safeParse(raw)
    if (!parsed.success) {
      throw badRequest('参数不合法', firstIssueOf(parsed.error))
    }
    const { username, password, role, displayName } = parsed.data
    if (actor.role === 'operator' && !OPERATOR_CREATABLE.includes(role)) {
      throw forbidden('运营无权创建该角色的账号')
    }

    const account = await createAccount({ username, password, role, displayName })
    return json(createAccountResponse.parse({ account }), 201)
  } catch (err) {
    return errorResponse(err)
  }
}
