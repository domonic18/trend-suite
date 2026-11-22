const KEY = 'trend-suite:draft-notice'

/**
 * 建课后触发起草失败的原因：带到方案页显示。
 * 课程已经建好（不回滚），教师不该为同一个错误再建一门课。
 */
export function setDraftNotice(message: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(KEY, message)
  } catch {
    // 隐私模式下没有 sessionStorage：提示丢了也不能挡住流程。
  }
}

/** 取出并清空（只显示一次）。 */
export function takeDraftNotice(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
    return value
  } catch {
    return null
  }
}
