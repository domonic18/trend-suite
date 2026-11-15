/**
 * 进程内滑动窗口限流（arch/02 §15 限流基线的第一档）。
 * 单实例部署成立；多实例部署需换共享存储。
 * 只记失败尝试——成功登录不占额度，否则教师反复登录会被误伤。
 */
type Bucket = { failures: number[] }

const buckets = new Map<string, Bucket>()

/** 丢掉窗口外的失败记录。 */
function prune(bucket: Bucket, windowMs: number, now: number): void {
  const cutoff = now - windowMs
  while (bucket.failures.length > 0 && (bucket.failures[0] as number) <= cutoff) {
    bucket.failures.shift()
  }
}

/** 命中上限时还需等待的秒数：最早那条失败滑出窗口的时间。 */
function retryAfter(bucket: Bucket, windowMs: number, now: number): number {
  const oldest = bucket.failures[0]
  if (oldest === undefined) return 0
  return Math.max(0, Math.ceil((oldest + windowMs - now) / 1000))
}

/** 只看不记：用于请求入口判断是否已经超限。 */
export function check(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterS: number } {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket) return { allowed: true, retryAfterS: 0 }
  prune(bucket, windowMs, now)
  if (bucket.failures.length >= limit) {
    return { allowed: false, retryAfterS: retryAfter(bucket, windowMs, now) }
  }
  return { allowed: true, retryAfterS: 0 }
}

/** 记一次失败。 */
export function hit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterS: number } {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { failures: [] }
    buckets.set(key, bucket)
  }
  prune(bucket, windowMs, now)
  bucket.failures.push(now)
  if (bucket.failures.length > limit) {
    return { allowed: false, retryAfterS: retryAfter(bucket, windowMs, now) }
  }
  return { allowed: true, retryAfterS: 0 }
}

/** 成功登录后撤掉计数——一次失败不该让随后成功的登录仍受罚。 */
export function forgive(key: string): void {
  buckets.delete(key)
}
