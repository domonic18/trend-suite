/** 页脚构建信息行（家族同款 aitech-hub）：NEXT_PUBLIC_ 构建期内联客户端 bundle，缺省显示 dev。 */
export function BuildInfo() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0-dev'
  const buildRef = process.env.NEXT_PUBLIC_BUILD_REF || 'dev'
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
  return (
    <p className="build-info">
      v{version} · {buildRef}
      {buildTime ? ` · 构建于 ${buildTime.slice(0, 16).replace('T', ' ')} UTC` : ''}
    </p>
  )
}
