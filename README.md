# trend-suite

monorepo（pnpm + Turborepo）：云端服务 + 学员端插件 + 跨端契约包。

## 目录

- `apps/cloud` — @trend-suite/cloud：云端服务（Fastify + PostgreSQL）：门户 / 管理台 / 教师生成工作台 / 生产 Agent（deepagents TS，见 `docs/arch/05`）+ 媒体管线 / 额度计费
- `apps/coach` — @trend-suite/coach：学员端 DSH 插件（host / client / shared 三分）
- `packages/contracts` — @trend-suite/contracts：跨端契约单一真相源（zod）
- `docs/` — 全部项目文档（requirement / arch / prototype 原型图 / plan / standard），入口 [docs/README.md](docs/README.md)

> 教师端为浏览器工作台（云端提供，ADR-02），无独立插件；生产 Agent 工艺包（skills/SKILL.md）位于 cloud 内，随 deepagents 挂载。

边界、纪律与命令详见 [AGENTS.md](AGENTS.md)。

## 快速开始

```bash
pnpm install
pnpm check && pnpm build && pnpm test
pnpm dev:cloud            # 127.0.0.1:3940/health
```

本地数据库：`pnpm --filter @trend-suite/cloud db:up`（workspace/ 持久化，不入库）。
