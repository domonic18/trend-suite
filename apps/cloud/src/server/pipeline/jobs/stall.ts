/**
 * worker 停滞判定（纯函数）。
 *
 * 背景（2026-11-20 预发实锤）：worker 认领任务的查询挂住后不再返回，
 * 排队任务二十多分钟无人认领（attempts 仍为 0），页面上表现为「生产中」永远不动。
 * 容器 restart 策略是 unless-stopped，所以自愈走「进程自杀 → 容器重启 → 新进程重新认领」。
 * 这里只判定「卡住了没有」，不碰数据库与容器。
 */

/** 默认停滞阈值：3 分钟内没有任何一次成功的数据库往返即判定卡死。 */
export const DEFAULT_STALL_TIMEOUT_MS = 180_000

export interface StallProbe {
  /** 最近一次成功数据库往返的时刻（毫秒时间戳） */
  lastAliveAt: number
  /** 当前时刻（毫秒时间戳） */
  now: number
  /** 停滞阈值（毫秒） */
  timeoutMs: number
}

export function isStalled(probe: StallProbe): boolean {
  return probe.now - probe.lastAliveAt >= probe.timeoutMs
}
