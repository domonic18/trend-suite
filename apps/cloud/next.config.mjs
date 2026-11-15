// 契约包是 TS 直出（main 指 src/index.ts），交给 Next 编译进 bundle。
// 用 .mjs 不用 .ts：运行镜像只有生产依赖（无 typescript），
// next.config.ts 在 next start 时会被现场编译并尝试联网装 TS，生产直接起不来。
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@trend-suite/contracts'],
}

export default nextConfig
