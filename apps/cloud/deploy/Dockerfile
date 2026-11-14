# 构建上下文是 monorepo 根目录（pnpm workspace），不是 apps/cloud。
# 先只拷各包的清单装依赖，再拷源码构建，避免源码改动触发整轮重装。
#
#   docker build -f apps/cloud/deploy/Dockerfile -t trend-suite .
#
# 依赖用 pnpm 装（仓库锁定 pnpm@9.15.9）——workspace:* 依赖 npm 无法解析。
# tsx 放在 dependencies（cloud/package.json）：dev watch、migrate CLI 与
# 契约包（TS 直出）运行期都要用它。
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
# 少拷这一份，tsc 会报 TS5083（找不到基配置）并连带把 module 退回 esnext 之外的默认值，
# 顶层 await 随之报错，构建阶段直接失败
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm --filter @trend-suite/cloud build

# 运行期依赖单独一版：只装生产依赖，镜像里不留 tsc/vite。
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
ENV APP_GIT_SHA=${GIT_SHA} \
    APP_BUILD_TIME=${BUILD_TIME}
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
COPY --from=build /app/apps/cloud/dist /app/apps/cloud/dist
COPY --from=build /app/apps/cloud/db /app/apps/cloud/db
COPY --from=build /app/apps/cloud/scripts /app/apps/cloud/scripts
USER node
WORKDIR /app/apps/cloud
EXPOSE 3940
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT??3940)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# 入口路径由 tsconfig.build.json 的 outDir 决定（dist/server）；
# 写错路径的表现是容器起来即退出、healthcheck 永远不通过、发布被自动回滚
CMD ["node", "dist/server/index.js"]
