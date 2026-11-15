// 契约包是 TS 直出（main 指 src/index.ts），交给 Next 编译进 bundle。
// 用 .mjs 不用 .ts：运行镜像只有生产依赖（无 typescript），
// next.config.ts 在 next start 时会被现场编译并尝试联网装 TS，生产直接起不来。
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@trend-suite/contracts'],
  // 对外 API 前缀是 /v1/*（arch/02 §1、§2 的六个路由族），但 Route Handlers 物理
  // 目录在 src/app/api/v1/ 下——Next 把 api 段也算进 URL，裸挂时只有 /api/v1/* 可达，
  // 前端与学员端插件按契约打 /v1/* 会全量 404。这里 rewrite 成对外形态。
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/v1/:path*' }]
  },
  webpack: (config) => {
    // 契约包内部用 NodeNext 的 './x.js' 写法（Node 运行时要求显式扩展名），
    // webpack 不认这个后缀 —— 把 .js 请求映射回 .ts 源文件。
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    }
    return config
  },
}

export default nextConfig
