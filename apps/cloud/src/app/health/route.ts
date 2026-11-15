// 冒烟与健康检查端点（deploy.sh 探活、镜像 HEALTHCHECK 都打在 /health）。
// 构建标识随镜像注入（Dockerfile ARG → APP_GIT_SHA / APP_BUILD_TIME）。
export function GET() {
  return Response.json({
    ok: true,
    gitSha: process.env.APP_GIT_SHA ?? 'dev',
    buildTime: process.env.APP_BUILD_TIME ?? 'unknown',
  })
}
