# trend-suite

monorepo（pnpm + Turborepo）：后端服务 + 双插件（生产端 / 学员端）+ 跨端契约包。

## 目录

- `apps/cloud` — @trend-suite/cloud：云端服务（Fastify + PostgreSQL，契约真相源）
- `apps/producer` — @trend-suite/producer：生产端插件
- `apps/coach` — @trend-suite/coach：学员端插件
- `packages/contracts` — @trend-suite/contracts：跨端契约单一真相源（zod）
- `docs/` — 全部项目文档（requirement / arch / prototype 原型图 / plan / ops / review / standard），入口 [docs/README.md](docs/README.md)

边界、纪律与命令详见 [AGENTS.md](AGENTS.md)。

## 快速开始

```bash
pnpm install
pnpm check && pnpm build && pnpm test
pnpm dev:cloud            # 127.0.0.1:3940/health
```

本地数据库：`pnpm --filter @trend-suite/cloud db:up`（workspace/ 持久化，不入库）。
