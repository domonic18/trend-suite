/** 轮询节奏单一真相（usePolling 的 intervalMs 入参）：活跃 3s、空闲兜底 60s。 */
export const POLL_MS = { active: 3_000, idle: 60_000 } as const
