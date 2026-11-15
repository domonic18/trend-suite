import { loginResponse, logoutResponse, meResponse, type SessionUser } from '@trend-suite/contracts'
import { clearToken, getToken, setToken } from './session'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { code?: string; message?: string }
    } | null
    throw new ApiError(body?.error?.message ?? `请求失败（${res.status}）`, res.status, body?.error?.code)
  }
  return (await res.json()) as T
}

export async function login(username: string, password: string): Promise<SessionUser> {
  const data = await request<unknown>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  const parsed = loginResponse.parse(data)
  setToken(parsed.token)
  return parsed.user
}

export async function me(): Promise<SessionUser> {
  const data = await request<unknown>('/v1/auth/me')
  return meResponse.parse(data).user
}

export async function logout(): Promise<void> {
  try {
    const data = await request<unknown>('/v1/auth/logout', { method: 'POST' })
    logoutResponse.parse(data)
  } finally {
    clearToken()
  }
}
