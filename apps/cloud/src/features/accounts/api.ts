import { loginResponse, logoutResponse, meResponse, type SessionUser } from '@trend-suite/contracts'
import { apiRequest } from '@/features/lib/http'
import { clearToken, setToken } from './session'

export async function login(username: string, password: string): Promise<SessionUser> {
  const data = await apiRequest<unknown>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  const parsed = loginResponse.parse(data)
  setToken(parsed.token)
  return parsed.user
}

export async function me(): Promise<SessionUser> {
  const data = await apiRequest<unknown>('/v1/auth/me')
  return meResponse.parse(data).user
}

export async function logout(): Promise<void> {
  try {
    const data = await apiRequest<unknown>('/v1/auth/logout', { method: 'POST' })
    logoutResponse.parse(data)
  } finally {
    clearToken()
  }
}
