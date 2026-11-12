# trend-suite — Agent 项目说明

> CLAUDE.md 仅含一行 `@AGENTS.md` 指针，本文件是唯一事实源。

## 1. 项目概览

monorepo（pnpm workspaces + Turborepo）：**一个云端服务 + 一个学员端插件 + 跨端契约包**。

- **云端**（`apps/cloud`）：Fastify + PostgreSQL + pgvector——门户、管理台、教师生产工作台、生产 Agent（deepagents TS 进程内，ADR-05）、媒体管线、额度计费。
- **学员端**（`apps/coach`）：DSH（DeepSeek Harness）框架上的 trend-coach 插件；推理上云（ADR-03），插件零密钥。
- **教师端无独立应用**：浏览器工作台由云端提供（ADR-02 生产端服务端化）。

## 2. 目录结构

```
trend-suite/
├── docs/                    # 全部项目文档（仿 SquadSight：分类 + 中文编号）
│   ├── requirement/         # 需求（主题需求.md，每主题一份，演进看 git）
│   ├── arch/                # 架构（总览 01 → 各域架构 02–04 → 实现方案 05–07）
│   ├── prototype/           # 原型图（HTML 静态原型 + assets/ 共享底座）
│   ├── flow/                # 端到端流程图（archify 交互 HTML）
│   ├── plan/  standard/     # 计划 / 规范
├── apps/
│   ├── cloud/               # 云端：src/ 平铺（领域模块）+ db/ + deploy/ + cicd/ + compose×3
│   │   └── skills/          #   （随实现落位）deepagents 工艺包 SKILL.md，服务端版本化
│   └── coach/               # 学员端插件（src/ host/client/shared 三分，见 docs/arch/04）
├── packages/
│   └── contracts/           # @trend-suite/contracts：跨端契约单一真相源（zod）
└── .github/workflows/       # CI（check / build / test）
```

## 3. 硬约束

1. **依赖纪律**：`apps/*` 之间禁止互相 import；`packages/*` 禁止依赖 `apps/*`；跨端共享的契约一律落 `packages/contracts`。
2. **契约先行**：接口字段/错误码变更先改 docs/requirement/ 需求与 contracts，再改实现与测试。
3. **应用内不嵌套 src/**：每个 app 只有一层 `src/`（Vite 类应用 index.html 与配置同层）。
4. **持久化数据**：运行期数据一律落各应用 `workspace/`（gitignore），不写其他路径、不提交入库；密钥只走 `.env` 注入（云端模型密钥走 `ai_models` 加密列，见 docs/arch/07）。
5. **文档随仓库走**：apps/* 只放代码与运行资产，项目文档一律在根 `docs/`，并在 docs/README.md 登记。
6. **提交**：Conventional Commits；未经用户批准不提交 git。
7. **生产 Agent 纪律**（ADR-05）：九步顺序由云端状态机强制（跑错序被挡）；模型调用统一经我们的 provider adapter（密钥不入环境明文、用量入账本）；产物必过三层校验，绝不部分落库；学员作答只在本机。

## 4. 常用命令

```bash
pnpm install && pnpm check && pnpm build && pnpm test
pnpm dev:cloud            # 127.0.0.1:3940
```

## 5. 改动规则

- 新增接口：先改 docs/requirement/ 与 packages/contracts，再实现与测试。
- 数据库变更走 `apps/cloud/db/migrations/`，命名 `NNNN_description.sql`，幂等可回放。
- 生产链路（媒体管线 / Agent 生产 / 教材 DSL / 课件断言 / 行情）改动前先读 docs/arch/05–07 对应节；断言词表与组件白名单扩展须冻结新契约版本。
- dsh 平台相关（仅学员端）：先对照 docs/arch/04 §8 的 P1–P12 硬约束基线。
- 编码细则见 `docs/standard/01项目规范.md`。

## 6. 决策速查（详见 docs/arch/01 §一）

| 编号 | 决策 |
|---|---|
| ADR-02 | 生产端服务端化：教师浏览器工作台 + 云端 worker + 模型云端预置 |
| ADR-03 | 学员推理上云 + 额度计费（弃 BYOK） |
| ADR-04 | 目录组织冻结（详见 docs/arch/01 §四） |
| ADR-05 | 云端 Agent = 确定性九步状态机 + deepagents（npm TS）进程内 + 自定义 BaseChatModel + assistant-ui |
