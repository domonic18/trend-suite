# @trend-suite/cloud

后端服务（Fastify + PostgreSQL）。文档在仓库根 `docs/`（需求 `requirement/`、架构 `arch/`、运维 `ops/`）。

## 常用命令

```bash
pnpm --filter @trend-suite/cloud dev     # 127.0.0.1:3940
pnpm --filter @trend-suite/cloud check   # 类型检查
pnpm --filter @trend-suite/cloud test
npm run db:up                              # 本地 PostgreSQL（workspace/ 持久化）
npm run migrate
```

## 目录约定

- `src/`：服务端代码（入口 + 领域模块平铺；**应用内不再嵌套 src/**）
- `db/`：数据库之家（migrations / initdb / seed）
- `deploy/`：镜像与反代（Dockerfile、caddy）
- `cicd/`：发布与监控（deploy.sh、monitoring 模板）
- `docker-compose*.yml`：compose 三件套（本地 PG / dev / prod）
- `workspace/`：运行期持久化数据（gitignore，不入库）
