# 构建上下文是 monorepo 根（见根 .dockerignore）。
#   docker build -f apps/cloud/deploy/Dockerfile -t trend-suite-cloud .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cloud/package.json apps/cloud/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --frozen-lockfile --filter @trend-suite/cloud...
COPY apps/cloud apps/cloud
COPY packages packages
RUN pnpm --filter @trend-suite/cloud build

FROM node:22-alpine
WORKDIR /app/apps/cloud
COPY --from=build /app ./
USER node
EXPOSE 3940
CMD ["node", "dist/server/index.js"]
