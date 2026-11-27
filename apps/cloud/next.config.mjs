// 契约包是 TS 直出（main 指 src/index.ts），交给 Next 编译进 bundle。
// 用 .mjs 不用 .ts：运行镜像只有生产依赖（无 typescript），
// next.config.ts 在 next start 时会被现场编译并尝试联网装 TS，生产直接起不来。
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@trend-suite/contracts', '@trend-suite/dsl'],
  // shadcn 组件从 'radix-ui' 聚合桶（35 个原语）整桶导入；Next 默认的按需导入
  // 优化只含 lucide-react，不含 radix-ui——不加这条，dev 每个页面每次编译都要
  // 处理整桶（本地切页慢的主因之一）。
  experimental: { optimizePackageImports: ['radix-ui'] },
  // 对外 API 前缀是 /v1/*（arch/02 §1、§2 的六个路由族），但 Route Handlers 物理
  // 目录在 src/app/api/v1/ 下——Next 把 api 段也算进 URL，裸挂时只有 /api/v1/* 可达，
  // 前端与学员端插件按契约打 /v1/* 会全量 404。这里 rewrite 成对外形态。
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/v1/:path*' }]
  },
}

export default nextConfig
