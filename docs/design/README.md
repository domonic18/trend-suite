# 原型图（design/）

生产级静态原型，可直接打开（无需构建）。命名：`portal-*`（公开网站——主页 / 登录 / 注册 / 设备授权 / 个人中心）/ `student-*`（**dsh 客户端内页面**——首启 / 体系 / 对话 / 课程 / 课堂，窗口 chrome 体现 harness 形态）/ `teacher-*`（教师生产工作台，浏览器）/ `ops-*`（运营控制台）。公开内容（能力介绍、下载安装、定价、FAQ、法务）全部收敛在主页 `portal.html` 内。**原型为非契约材料**：评审采纳的结论须回写 requirement/ 与 arch/（已按三轮打磨回写至教师端 v0.3 / 学员端 v0.2）。

入口：[index.html](index.html)（原型索引，含全部页面与两条运行图的跳转、页面 ↔ 流程节点映射）。

## 组织方式（v4 重构，2026-11-11）

- **共享样式底座 + 页面级少量内联**（替代原「逐页复制内联」——复制发散曾导致 8 页双文档拼接错乱）：
  - `assets/tokens.css`：全局设计 token（三族色板 / 字体 / 圆角 / 行情红涨绿跌），源自 trend-studio 已验证实现
  - `assets/family-portal.css`：门户族底座（玻璃吸顶导航 / home-hero / 能力图文 / page-hero + auth-card / account 面板 / 浅色页脚）
  - `assets/family-admin.css`：工作台族底座（侧栏 / 玻璃顶栏 / 状态徽章 / 表格 / 九步格 / 发布步骤等共享组件）
  - `assets/family-dsh.css`：dsh 客户端族底座（窗口 chrome / 三栏 / 引用芯片 / 额度 pill / 全局导航条）
- **页面间导航全量接线**：导航一律 `<a href>`（含锚点），页内动作用 `<button>`；dsh 页顶栏为 体系/对话/课程/课堂 + 额度 pill；工作台侧栏/顶栏全互链。
- **运行图跳转**：`../flow/*.html` 内节点已注入「原型」芯片与右下角图例（`ts-proto-*`，见各文件末尾标记块）。**archify 再生成后需重放注入**（映射表见注入脚本注释）。

## 设计语言（v3 对齐 trend-studio 已实现风格，2026-11-11）

对齐源：`trend-studio/apps/cloud/src/portal/styles.css` 与 `admin/styles.css + App.tsx` 主题令牌。

- **门户族（学员官网/落地/注册/登录/设备授权/个人中心）**：蓝 `#2563eb` 主色 + 绿 `#0f9d76` 点缀；毛玻璃吸顶导航 + 活性胶囊；径向渐变 hero（蓝绿柔光）+ kicker 胶囊 + 四格数据卡；三/四列能力卡（卡片投影 `0 18px 48px`）；双列大数字步骤路径；深蓝渐变 CTA 带（`#11203d → #1d3b74`）；页宽 `min(1160px, 100vw−48px)`。
- **工作台族（教师 4 页 + 运营 4 页）**：admin 深色控制台——底 `#0c0e12`、面板 `#111318`、边 `#23262f/#20242e`、主色靛紫 `#5e6ad2`（Linear 风）、8px 圆角；侧栏品牌区（32px 圆角 9 方标）+ 分组菜单 + 底部用户卡；玻璃顶栏（blur 12px）+ 面包屑 + 课程选择器；状态色点（ok 绿 / run 靛 / warn 琥珀 / err 粉）。
- **dsh 客户端族（体系/会话/课程页/课堂/首启）**：石墨三栏桌面客户端窗口 chrome，引用等宽芯片，额度细计量条——保持独立，不与 Web 端混同。
- 行情图表红涨绿跌（`#e05d68/#31a984` 深色底）；全程零 emoji，16px 线性 SVG 图标。

## 页面清单与需求覆盖

### 教师端 · 生产工作台

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [teacher-workbench](teacher-workbench.html) | B1 预置模型横幅·账号；B2 直传（≤2GiB·断点）·增量转写·source units；**触发方案制作**（选集/目标/目录先验+预检）；建课；课程卡。流程：`h_brief` / `c_upload` / `h_trigger` |
| [teacher-plan](teacher-plan.html) | 门禁① 方案确认**三动作**（批准/微调/打回）+ 版本历史；目录先验校验；概念图谱·术语表；**异常：提纲与素材不匹配**（修订/补素材）；综合 Agent 说明。流程：`h_plan` / `a_synthesis` / `x_outline` |
| [teacher-production](teacher-production.html) | 九步引擎（顺序强制·状态九格）；逐节子代理并行；断点续跑；**异常：证据不足挂起**（补素材恢复）；回灌中（2/3）；**追加素材三选一**（影响面先算）；**人工待办**（回灌超限·概念冲突）；流程向导。流程：`a_section` / `x_material` / `x_rework` |
| [teacher-review](teacher-review.html) | 评审 Agent rubric 自评；就绪度五门禁+指纹；**成品审核决策点**（通过/打回）；签批归运营（按钮隐藏）；富媒体逐节预览；**结构化编辑三抽屉**（术语抽屉可视化·归档可逆）。流程：`a_review` / `c_readiness` / `h_audit` |

### 门户 · 公开网站（portal-*）

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [portal](portal.html) | **主页（唯一公开页面）**：hero + 产品视觉 → 站点功能能力图文（带引用问答 / 片段定位 / 课程体系 / 互动课堂）+ bento（安装 / 设备码授权 / 额度计费 / 案例股）→ 体系概览 → 学习路径 → S2 下载（macOS/Windows 如实告知）→ 定价与计费边界 → FAQ → 法务要点；ADR-03 零配置说明。流程：`c_portal` / `s_install` |
| [portal-register](portal-register.html) | S1 注册（独立页）：用户名/密码校验、协议勾选、防刷限流说明 |
| [portal-login](portal-login.html) | S1 登录：本机保留登录态、忘记密码走管理员重置、设备授权提示 |
| [portal-device-auth](portal-device-auth.html) | 流程节点 `c_auth` 落地界面：四格用户码核对、登录并批准、不一致警示、10 分钟时效 |
| [portal-account](portal-account.html) | S8 额度中心（余额/明细不含问题原文/充值/防重复加额）；设备管理解绑；隐私开关；改密注销。流程：`s_keep` / `x_quota` |

### 学员端 · dsh 客户端族

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [student-setup](student-setup.html) | S3 首启**仅一步登录**（设备码·授权页自动打开·注册即登录）；dsh 客户端窗口 chrome。流程：`s_setup` |
| [student-system](student-system.html) | S4/S5 **体系页**：课程→章节→知识点树（懒加载）、我的课程与学习路径、知识点带上下文提问。流程：`s_learn` |
| [student-chat](student-chat.html) | S4 提问·云端推理带引用·segmentId 回跳；额度 pill 透明扣减；**额度耗尽**（充值入口·浏览照常）；**空召回拒答**（最近知识点）；S6 语音 ≤60s·**自动上下文本机开关**；dsh 三栏。流程：`p_ask` |
| [student-course](student-course.html) | S5 富媒体课程页（警示卡/片段卡/案例股 K 线 SVG·周期声明·事件锚点/逐根回放）；签名播放（窗校验·水印·**过期/越窗异常条**）；免费徽章；进度与版本门禁。流程：`p_view` / `x_expired` |
| [student-class](student-class.html) | S7 互动课堂（本地 TTS·白板标注同步·随堂测验本地评分·复习清单）；**不耗额度**徽章。流程：`s_keep` |

### 运营端 · 控制台

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [ops-models](ops-models.html) | B1：LLM/VLM/ASR/Embedding 条目（密钥加密掩码、连通性测试）+ 任务级主备绑定 + 冷却说明 |
| [ops-usage](ops-usage.html) | B3 非功能：汇总指标带、按任务/按模型维度、来源筛选（教师生产/学员问答）、成本估算与未配置口径、**组织预算 80% 预警 / 100% 硬停**、对账说明 |
| [ops-publish](ops-publish.html) | B4：就绪度五门禁、签批（指纹/幂等/审批记录）、发布五步（迁移先行/回滚）、发布历史。流程：`ops_signoff` / `ops_publish` |
| [ops-accounts](ops-accounts.html) | B1/流程 `ops_account`：账号列表（角色/状态/设备）、建 producer 账号（邀请码一次性显示）、安全口径 |

打磨记录：R1 全量生成（10 页）→ R2 正向覆盖审核补 3 缺口 → R3 反向审核补需求（教师 v0.3 五项 + 学员周期声明）→ R4 复审补齐 8 页（2026-11-11）→ **R5 v4 重构**（2026-11-11：拆 8 页双文档拼接、修复 dsh 字体简写与门户未定义变量、共享底座 tokens/family-\*、全站导航接线、新增体系页与原型索引、运行图注入跳转）→ **R6 门户族按 trend-studio 实现移植**（2026-11-11：首页/登录/注册/设备授权/个人中心/落地页对齐已实现 portal——portal-header 导航、home-hero 五段结构、page-hero + auth-card 认证版式、account-grid 双列面板、浅色 portal-footer；BYOK 旧文案已按 ADR-03 调整为云端供给）→ **R7 落地页转型**（2026-11-11：landing-course 课程落地页改为 landing-features 站点功能落地页——少文字、每能力配纯 CSS/SVG 产品视觉 mockup，图文交替 + bento；门户导航「交易体系」改指页内 #system 体系概览）→ **R8 信息架构收敛**（2026-11-11：独立落地页删除、能力图文并入主页 portal.html；`student-portal/login/register/device-auth/account` 更名 `portal-*`；**student-\* 仅保留 dsh 客户端五页**（setup/system/chat/course/class）；全站引用与运行图注入映射同步更新）。
