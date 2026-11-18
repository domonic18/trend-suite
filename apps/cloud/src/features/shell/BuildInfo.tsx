/**
 * 页脚构建信息行（家族同款 aitech-hub）：NEXT_PUBLIC_ 构建期内联客户端 bundle，缺省显示 dev。
 * 构建时间按北京时间展示（CI 注入的是 UTC，运维口径是本地时间，避免读表时差 8 小时）。
 */
export function BuildInfo() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0-dev'
  const buildRef = process.env.NEXT_PUBLIC_BUILD_REF || 'dev'
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
  const shown = buildTime ? beijingTime(buildTime) : null
  return (
    <p className="build-info">
      v{version} · {buildRef}
      {shown ? ` · 构建于 ${shown}（UTC+8）` : ''}
      {buildTime && !shown ? ` · 构建于 ${buildTime}` : ''}
    </p>
  )
}

/** ISO 时间串 → 北京时间墙钟（UTC+8）。纯字符串运算，服务端与客户端结果一致。 */
function beijingTime(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!match) return null
  const shifted = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) + 8, Number(match[5])),
  )
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  )
}
