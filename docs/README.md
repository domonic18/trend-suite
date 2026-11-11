# trend-suite 文档地图

本文件是全仓文档唯一入口；新增文档时同步更新。

## 1. 目录体系（仿 SquadSight：分类目录 + 中文编号文档）

| 目录 | 放什么 | 命名规则 |
|---|---|---|
| `requirement/` | 需求文档 | `主题需求.md`（**每主题一份**，演进看 git 历史；大改先在 review/ 留评审记录） |
| `arch/` | 架构设计 | `NN主题.md`（如 `01整体架构设计.md`），按主题编号 |
| `prototype/` | 原型图：HTML 静态原型页 + `assets/`（共享样式底座 tokens.css / family-*.css 等素材），入口 `prototype/index.html` | 页面名.html |
| `flow/` | 端到端流程图：Archify 交互式 HTML（同名 `.candidate.json` 为可编辑源；页面内「原型」跳转芯片为人工注入，再生成后需重放，见 prototype/README.md） | 页面名.html |
| `plan/` | 实施计划 / 重构方案 | `01-方案名.md` |
| `ops/` | 运维（部署 Runbook、监控、配置） | `NN主题.md` |
| `review/` | 评审记录（架构 Review、验收） | `01-主题Review.md` |
| `standard/` | 团队规范（项目规范、数据库规范等） | `NN规范名.md` |

## 2. 现有文档

| 文档 | 说明 |
|---|---|
| [requirement/教师端需求.md](requirement/教师端需求.md) | 教师视角（现行）：服务端化 + **Agent 编排四角色 · 方案三动作 · 触发时序 · 异常与人工介入契约（B5）** |
| [requirement/教师端需求.md](requirement/教师端需求.md) | 已被 v0.3 取代，服务端化首版留档 |
| [requirement/教师端需求.md](requirement/教师端需求.md) | 已被 v0.2 取代，插件架构留档 |
| [requirement/学员端需求.md](requirement/学员端需求.md) | 学员视角（**推理上云·额度计费**，ADR-03）：两步开通 → 云端问答 → 额度与充值 |
| [requirement/学员端需求.md](requirement/学员端需求.md) | 已被 v0.2 取代，BYOK 形态留档 |
| [arch/01整体架构设计.md](arch/01整体架构设计.md) | 整体架构：协同、数据存储、部署 |
| [arch/02生产端服务端化决策.md](arch/02生产端服务端化决策.md) | ADR：生产端弃用 dsh 插件改云端实现，模型云端预置 |
| [arch/03学员推理上云与额度计费决策.md](arch/03学员推理上云与额度计费决策.md) | ADR：学员推理平台供给，弃 BYOK，额度计费与充值 |
| [standard/01项目规范.md](standard/01项目规范.md) | 分支/提交/代码纪律/测试/文档规则 |
| [ops/01部署Runbook.md](ops/01部署Runbook.md) · [02监控与告警.md](ops/02监控与告警.md) | 运维 |
| [flow/teacher-e2e.html](flow/teacher-e2e.html) | 教师端端到端流程图（Agent 驱动制作：人只把关方案与审核，异常分支闭环） |
| [flow/student-e2e.html](flow/student-e2e.html) | 学员端端到端流程图（两步开通 · 平台供给 · 额度计费） |

## 3. 维护规则

- 需求大改：直接改 `主题需求.md` 并在文首状态行注明变更来源；演进轨迹看 git 历史。
- 架构决策记录进 `arch/` 对应文档的 ADR 表；大改先在 `review/` 留评审记录。
- 契约变更一次改齐：requirement → arch → packages/contracts → 实现 → 测试。
- 各应用目录（apps/*）只放代码与运行资产，项目文档一律在根 `docs/`。
