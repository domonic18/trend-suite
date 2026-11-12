# trend-suite 文档地图

本文件是全仓文档唯一入口；新增文档时同步更新。

## 1. 目录体系（仿 SquadSight：分类目录 + 中文编号文档）

| 目录 | 放什么 | 命名规则 |
|---|---|---|
| `requirement/` | 需求文档 | `主题需求.md`（**每主题一份**，演进看 git 历史） |
| `arch/` | 架构设计 | `NN主题.md`（如 `01整体架构设计.md`），按主题编号 |
| `prototype/` | 原型图：HTML 静态原型页 + `assets/`（共享样式底座 tokens.css / family-*.css 等素材），入口 `prototype/index.html` | 页面名.html |
| `flow/` | 端到端流程图：Archify 交互式 HTML（同名 `.candidate.json` 为可编辑源；页面内「原型」跳转芯片为人工注入，再生成后需重放，见 prototype/README.md） | 页面名.html |
| `plan/` | 实施计划 / 重构方案 | `01-方案名.md` |
| `standard/` | 团队规范（项目规范、数据库规范等） | `NN规范名.md` |

## 2. 现有文档

| 文档 | 说明 |
|---|---|
| [requirement/教师端需求.md](requirement/教师端需求.md) | 教师视角（现行）：服务端化 + **Agent 编排四角色 · 方案三动作 · 触发时序 · 异常与人工介入契约（B5）** |
| [requirement/学员端需求.md](requirement/学员端需求.md) | 学员视角（**推理上云·额度计费**，ADR-03）：两步开通 → 云端问答 → 额度与充值 |
| [arch/01整体架构设计.md](arch/01整体架构设计.md) | **总览**：系统概述与决策记录、技术选型（含替换策略）、系统架构图与端职责边界、项目目录结构与模块边界、架构文档索引 |
| [arch/02云端服务架构.md](arch/02云端服务架构.md) | 架构：cloud 领域模块与鉴权、DB 任务队列与 worker、部署形态与发布流水线、备份恢复、监控告警、限流基线、安全隐私基线、测试分层与 CI 门禁 |
| [arch/03数据存储设计.md](arch/03数据存储设计.md) | 架构：领域模型与不变量、**在线检索管线（向量+词法+RRF+双阈值+裁剪）**、事务边界、迁移规则 |
| [arch/04学员端插件架构.md](arch/04学员端插件架构.md) | 架构：coach 的 host/client/shared、与 DSH 宿主的协作面、问答与引用回跳链路、隐私护栏、**DSH 平台硬约束 P1–P12**、插件打包与装载 |
| [arch/05内容生产链路实现方案.md](arch/05内容生产链路实现方案.md) | 实现方案：**直传上传 → 存储 → 转码 → ASR → 关键帧 → 四角色九步生产 → 三层校验 → 门禁与签批发布** |
| [arch/06教材呈现与交互课件实现方案.md](arch/06教材呈现与交互课件实现方案.md) | 实现方案：**教材 DSL 与呈现层 + K 线图/互动题目**：组件白名单、断言证明、行情口径、运行时契约 |
| [arch/07平台服务方案.md](arch/07平台服务方案.md) | 实现方案：额度计费与充值（ADR-03）、模型配置与 AI 用量、预算硬停 |
| [standard/01项目规范.md](standard/01项目规范.md) | 分支/提交/代码纪律/测试/文档规则 |
| [prototype/](prototype/) | 原型图（portal / student-dsh / teacher / ops 四组 + 原型索引），见 [prototype/README.md](prototype/README.md) |
| [flow/teacher-e2e.html](flow/teacher-e2e.html) | 教师端端到端流程图（Agent 驱动制作：人只把关方案与审核，异常分支闭环） |
| [flow/student-e2e.html](flow/student-e2e.html) | 学员端端到端流程图（两步开通 · 平台供给 · 额度计费） |

## 3. 维护规则

- 需求大改：直接改 `主题需求.md` 并在文首状态行注明变更来源；演进轨迹看 git 历史。
- 架构决策记录进 `arch/` 对应文档的 ADR 表。
- 契约变更一次改齐：requirement → arch → packages/contracts → 实现 → 测试。
- 各应用目录（apps/*）只放代码与运行资产，项目文档一律在根 `docs/`。
