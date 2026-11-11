# trend-suite — Agent 项目说明

> CLAUDE.md 仅含一行 `@AGENTS.md` 指针，本文件是唯一事实源。

## 1. 项目概览

monorepo（pnpm workspaces + Turborepo）：一个后端服务 + 两个插件 + 跨端契约包。

## 2. 目录结构

```
trend-suite/
├── docs/                    # 全部项目文档（仿 SquadSight：分类 + 中文编号文档）
│   ├── requirement/         # 需求（主题需求v版本.md，版本并存）
│   ├── arch/                # 架构设计（NN主题.md）
│   ├── prototype/          # 原型图（HTML 静态原型 + assets/）
│   ├── plan/  ops/  review/  standard/   # 计划 / 运维 / 评审 / 规范
├── apps/
│   ├── backend/             # Fastify 后端；src/ 平铺 + db/ + deploy/ + cicd/ + compose×3
│   ├── producer/            # 生产端插件（src/ + skills/）
│   └── coach/               # 学员端插件（src/）
├── packages/
│   └── contracts/           # @trend-suite/contracts：跨端契约单一真相源（zod）
└── .github/workflows/       # CI（check / test）
```

## 3. 硬约束

1. **依赖纪律**：`apps/*` 之间禁止互相 import；`packages/*` 禁止依赖 `apps/*`；跨端共享的契约一律落 `packages/contracts`。
2. **契约先行**：接口字段/错误码变更先改 docs/requirement/ 需求与 contracts，再改实现与测试。
3. **应用内不嵌套 src/**：每个 app 只有一层 `src/`（Vite 类应用 index.html 与配置同层）。
4. **持久化数据**：运行期数据一律落各应用 `workspace/`（gitignore），不写其他路径、不提交入库；密钥只走 `.env` 注入。
5. **文档随仓库走**：apps/* 只放代码与运行资产，项目文档一律在根 `docs/`，并在 docs/README.md 登记。
6. **提交**：Conventional Commits；未经用户批准不提交 git。

## 4. 常用命令

```bash
pnpm install && pnpm check && pnpm build && pnpm test
pnpm dev:cloud            # 127.0.0.1:3940
```

## 5. 改动规则

- 新增接口：先改 docs/requirement/ 与 packages/contracts，再实现与测试。
- 数据库变更走 `apps/cloud/db/migrations/`，命名 `NNNN_description.sql`，幂等可回放。
- 编码细则见 `docs/standard/01项目规范.md`。
