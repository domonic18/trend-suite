import 'server-only'

/**
 * 迭代 4 冻结阈值（docs/plan/01 §风险表：每迭代开工前冻结，标定后再调整）。
 * 并行度：arch/05 §6「单课并行度上限可配（起步 3–4）」取下限。
 * 回灌：arch/05 §7「回灌 ≤3 次，超限转人工待办」。
 */
export const MAX_SECTIONS_PARALLEL = 3
export const MAX_ATTEMPTS = 3
