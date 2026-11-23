/**
 * 浏览器会话令牌（教师端需求 T1）：只存 sessionStorage，不落 Cookie。
 * 服务端渲染期拿不到令牌——工作台因此是纯客户端壳，令牌校验走 API。
 *
 * 这里是令牌的唯一读写口：setToken / clearToken 写入后即发布变更，
 * 订阅者（SessionProvider）据此重新校验身份。observable auth state 模式，
 * 同 Supabase onAuthStateChange / Firebase onAuthStateChanged——
 * 改令牌的流程（登录、登出、401 清除）都自动传播，组件不做任何旁路编排。
 * sessionStorage 是标签页私有的，变更天然只在当前标签页内传播。
 */
const TOKEN_KEY = 'trend-suite.session.token'

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type TokenStore = {
  get(): string | null
  set(token: string): void
  clear(): void
  /** 订阅令牌变更，返回退订函数。 */
  subscribe(listener: () => void): () => void
}

export function createTokenStore(storage: TokenStorage): TokenStore {
  const listeners = new Set<() => void>()
  return {
    get: () => storage.getItem(TOKEN_KEY),
    set: (token) => {
      storage.setItem(TOKEN_KEY, token)
      for (const fn of listeners) fn()
    },
    clear: () => {
      storage.removeItem(TOKEN_KEY)
      for (const fn of listeners) fn()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let store: TokenStore | null = null
function storeOf(): TokenStore {
  store ??= createTokenStore(window.sessionStorage)
  return store
}

export function getToken(): string | null {
  return storeOf().get()
}

export function setToken(token: string): void {
  storeOf().set(token)
}

export function clearToken(): void {
  storeOf().clear()
}

export function subscribeToken(listener: () => void): () => void {
  return storeOf().subscribe(listener)
}
