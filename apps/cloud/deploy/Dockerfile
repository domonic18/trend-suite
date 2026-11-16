# 构建上下文是 monorepo 根目录（pnpm workspace），不是 apps/cloud。
# 先只拷各包的清单装依赖，再拷源码构建，避免源码改动触发整轮重装。
#
#   docker build -f apps/cloud/deploy/Dockerfile -t trend-suite .
#
# 依赖用 pnpm 装（仓库锁定 pnpm@9.15.9）——workspace:* 依赖 npm 无法解析。
# tsx 放在 dependencies（cloud/package.json）：migrate CLI（db/migrations 的
# SQL 执行入口 scripts/db/migrate.ts 经 tsx 直跑）与契约包（TS 直出）运行期都要用它。
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/package.json
COPY packages/contracts/package.json packages/contracts/package.json
# ... 选云端应用及其工作区依赖（契约包）
RUN pnpm install --frozen-lockfile --filter @trend-suite/cloud...
COPY apps/cloud apps/cloud
COPY packages packages
# 根 tsconfig 是 apps/cloud/tsconfig.json 的 extends 目标——
# 少拷这一份，tsc 会报 TS5083（找不到基配置），类型检查直接失败
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @trend-suite/cloud build

# 运行期依赖单独一版：只装生产依赖，镜像里不留 tsc。
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --prod --filter @trend-suite/cloud...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
# 构建标识随镜像走：CI 注入 commit 与构建时间，/health 展示
ARG GIT_SHA=dev
ARG BUILD_TIME=unknown
# 应用版本 = VERSION 文件 + 运行号（CI 注入），与 package.json version 同源
ARG APP_VERSION=0.0.0-dev
ENV APP_GIT_SHA=${GIT_SHA} \
    APP_BUILD_TIME=${BUILD_TIME} \
    APP_VERSION=${APP_VERSION}
# 端口与 HEALTHCHECK 必须一致：next start 不设 PORT 时默认听 3000，
# 而健康检查探的是 3940 —— 端口不显式钉住，容器会被判 unhealthy 触发回滚。
ENV PORT=3940 \
    HOSTNAME=0.0.0.0
# 媒体管线在 runtime 直接 spawn ffmpeg/ffprobe（arch/05 §3）；
# 预建 /data 目录供容器直接运行（HLS 与管线工作区同卷，原子 rename）
RUN apk add --no-cache ffmpeg \
 && mkdir -p /data/storage /data/hls \
 && chown -R node:node /data
WORKDIR /app
# pnpm 的隔离布局靠相对符号链接串起来：.pnpm 实际存储 + 各包的 node_modules
# 必须保持同一棵相对目录，链接才解析得到。
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/cloud/node_modules /app/apps/cloud/node_modules
COPY --from=prod-deps /app/packages/contracts/node_modules /app/packages/contracts/node_modules
# 工作区包在运行期被云端按包名 import（契约是 zod schema 的单一真相），
# 契约包 main 指 src/index.ts（TS 直出，经 tsx 加载），整包带上
COPY --from=build /app/packages/contracts/package.json /app/packages/contracts/package.json
COPY --from=build /app/packages/contracts/src /app/packages/contracts/src
COPY --from=build /app/apps/cloud/package.json /app/apps/cloud/package.json
# Next.js 产物：.next 是运行期所需的全部编译输出；
# 运行期是全量生产依赖镜像（非 standalone），migrate 契约与 cloud 应用共用一个镜像
COPY --from=build /app/apps/cloud/.next /app/apps/cloud/.next
# 用 .mjs 配置：运行镜像无 typescript，.ts 配置会在 next start 时被现场编译并联网装 TS
COPY --from=build /app/apps/cloud/next.config.mjs /app/apps/cloud/next.config.mjs
COPY --from=build /app/apps/cloud/public /app/apps/cloud/public
# 迁移集与入口（compose migrate profile 与本镜像同容器运行，迁移随镜像版本化）
COPY --from=build /app/apps/cloud/db /app/apps/cloud/db
COPY --from=build /app/apps/cloud/scripts /app/apps/cloud/scripts
# 服务端源码：seed 脚本要复用应用的口令哈希实现（scrypt），
# 而运行期镜像只带 .next 编译产物——哈希算法只能有一份，不能在脚本里另抄一遍
COPY --from=build /app/apps/cloud/src/server /app/apps/cloud/src/server
# worker 进程入口（arch/02 §7：同镜像，APP_ROLE=worker 区分）：
# 加工 worker 要跑服务端代码，不能只带 .next 编译产物。
# --conditions=react-server 让 'server-only' 解析为空模块，裸 node 才能加载这些文件。
COPY --from=build /app/apps/cloud/src/env.ts /app/apps/cloud/src/env.ts
COPY --from=build /app/apps/cloud/src/worker.ts /app/apps/cloud/src/worker.ts
# tsx 靠 tsconfig 的 paths 解析 '@/' 别名；运行期镜像没有 .next 的类型产物，
# 只拷这两份配置（根 tsconfig 是 apps/cloud 的 extends 目标，缺它别名解析不到）
COPY --from=build /app/apps/cloud/tsconfig.json /app/apps/cloud/tsconfig.json
COPY --from=build /app/tsconfig.base.json /app/tsconfig.base.json
USER node
WORKDIR /app/apps/cloud
EXPOSE 3940
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT??3940)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# next start 读 PORT/HOSTNAME 环境变量（compose 注入），默认监听 0.0.0.0
CMD ["./node_modules/.bin/next", "start"]
