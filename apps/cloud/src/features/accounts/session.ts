/**
 * 浏览器会话令牌（教师端需求 T1）：只存 sessionStorage，不落 Cookie。
 * 服务端渲染期拿不到令牌——工作台因此是纯客户端壳，令牌校验走 API。
 */
const TOKEN_KEY = 'trend-suite.session.token'

export function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  window.sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  window.sessionStorage.removeItem(TOKEN_KEY)
}
