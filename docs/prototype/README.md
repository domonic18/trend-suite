# 原型图（prototype/）

生产级静态原型，可直接打开（无需构建）。命名：`portal-*`（公开网站——主页 / 登录 / 注册 / 设备授权 / 个人中心）/ `student-*`（**dsh 客户端内页面**——首启 / 体系 / 对话 / 课程 / 课堂，窗口 chrome 体现 harness 形态）/ `teacher-*`（教师生产工作台，浏览器）/ `ops-*`（运营控制台）。公开内容（能力介绍、下载安装、定价、FAQ、法务）全部收敛在主页 `portal.html` 内。**原型为非契约材料**：评审采纳的结论须回写 requirement/ 与 arch/（已按三轮打磨回写至教师端 v0.3 / 学员端 v0.2）。

入口：[index.html](index.html)（原型索引，含全部页面与两条运行图的跳转、页面 ↔ 流程节点映射）。

## 组织方式（v4 重构，2026-11-11）

- **共享样式底座 + 页面级少量内联**（替代原「逐页复制内联」——复制发散曾导致 8 页双文档拼接错乱）：
  - `assets/tokens.css`：全局设计 token（三族色板 / 字体 / 圆角 / 行情红涨绿跌），源自 trend-studio 已验证实现
  - `assets/family-portal.css`：门户族底座（玻璃吸顶导航 / home-hero / 能力图文 / page-hero + auth-card / account 面板 / 浅色页脚）
  - `assets/family-teacher.css`：教师工作台底座（旅程步进器 / 告警条 / 节卡片九步格 / 任务计划卡 / rubric / 工具卡，浅色；shell 复用 family-ops）
  - `assets/family-agent.css`：教师端 Agent 协作层（三栏 `has-agent` / 阶段条 / 单一主行动 / Agent rail 三 Tab / 消息与计划 / 工具卡 / 子代理树 / HITL 决策卡 / 产物树 / 审核分栏与就绪度）
  - `assets/family-ops.css`：运营控制台底座（后台管理布局：侧栏 + 顶栏面包屑 + 面卡表格，浅色门户色板）
  - `assets/family-dsh.css`：dsh 客户端族底座（窗口 chrome / 三栏 / 引用芯片 / 额度 pill / 全局导航条）
- **页面间导航全量接线**：导航一律 `<a href>`（含锚点），页内动作用 `<button>`；dsh 页顶栏为 体系/对话/课程/课堂 + 额度 pill；工作台侧栏/顶栏全互链。
- **运行图跳转**：`../flow/*.html` 内节点已注入「原型」芯片与右下角图例（`ts-proto-*`，见各文件末尾标记块）。**archify 再生成后需重放注入**（映射表见注入脚本注释）。

## 设计语言（v3 对齐 trend-studio 已实现风格，2026-11-11）

对齐源：`trend-studio/apps/cloud/src/portal/styles.css` 与 `admin/styles.css + App.tsx` 主题令牌。

- **门户族（学员官网/落地/注册/登录/设备授权/个人中心）**：蓝 `#2563eb` 主色 + 绿 `#0f9d76` 点缀；毛玻璃吸顶导航 + 活性胶囊；径向渐变 hero（蓝绿柔光）+ kicker 胶囊 + 四格数据卡；三/四列能力卡（卡片投影 `0 18px 48px`）；双列大数字步骤路径；深蓝渐变 CTA 带（`#11203d → #1d3b74`）；页宽 `min(1160px, 100vw−48px)`。
- **工作台族（教师 9 页）**：浅色后台（与 portal/ops 同族）——复用 ops shell（侧栏 + 顶栏面包屑 + 面卡）与门户色板（蓝 `#2563eb` / 绿 `#0f9d76`），旅程组件浅色版见 family-teacher.css（R16 起统一，family-admin.css 深色版已移除）。R18 起教师页统一 **三栏 Agent 协作布局**：导航 / 主区 / 常驻 Agent rail（对话·执行·产物），确认与待办以对话内决策卡呈现；R23 工作区收敛为**两页模型**——原始数据（上传/解析/逐字稿/关键帧）与教材（结构树 + 渲染后的 HTML 教材 + Agent 生成侧栏），侧栏仅保留「所有课程 / 原始数据 / 教材 / 用量与成本」。
- **dsh 客户端族（体系/会话/课程页/课堂/首启）**：石墨三栏桌面客户端窗口 chrome，引用等宽芯片，额度细计量条——保持独立，不与 Web 端混同。
- 行情图表红涨绿跌（`#e05d68/#31a984` 深色底）；全程零 emoji，16px 线性 SVG 图标。

## 页面清单与需求覆盖

### 教师端 · 生产工作台

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [teacher-login](teacher-login.html) | B2 producer 专属登录入口（分屏）：零安装零密钥、会话 sessionStorage、邀请码开户指引；说明 Agent 执行可见与确认动作内嵌。 |
| [teacher-workbench](teacher-workbench.html) | **所有课程**：极简课程卡列表（总论卷生成中 / 筹码分布卷草稿 / 趋势交易基础已发布）+ 新建课程；点开即进入教材。**无 Agent rail**。流程：`h_brief` |
| [teacher-material](teacher-material.html) | **原始数据**：上传视频 → 解析 → ASR 逐字稿 + 关键帧。单一大拖拽区（断点续传、自动转写）；视频列表四态（完成 / 转写中 / 排队 / 失败）；完成项展示转写管道、逐字稿（时间戳 / 说话人 / `[[unit]]` 锚）与关键帧缩略图；页脚「用这份逐字稿生成教材」跳 `teacher-textbook`。流程：`c_upload` |
| [teacher-textbook](teacher-textbook.html) | **教材**：三栏。左章节/单元结构树（状态点、版本、生成中）；中为**渲染后的 HTML 教材**（标题 / 引子 / 提示卡 / K 线图 / 片段回放 / 随堂练习 / 溯源注记，段级「让 Agent 改」）；右为 **Agent 生成侧栏**——todo 章节计划、工具调用卡、`section-writer` skill 调用、diff、HITL 应用确认、流式输出与产物树（HTML 文件）。流程：`a_section` / `c_readiness` |
| 旧流程页面（保留参考，不进入主导航） | [teacher-plan](teacher-plan.html) 课程大纲 · [teacher-assets](teacher-assets.html) 内容资产 · [teacher-production](teacher-production.html) 逐节生产 · [teacher-compose](teacher-compose.html) 编排预览 · [teacher-review](teacher-review.html) 成品审核 |

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
| [student-course](student-course.html) | S5 富媒体课程页 · **课件目标效果**（对齐 trend-studio 教材呈现原型）：hero 节头/四型 callout/术语边注/先想一想/A·B 类图示/对比滑块/**老师标注 + 逐根回放判断闭环**/画中画联动/滚动叙事/即时自检（含目录条与阅读进度）；签名播放（窗校验·水印·**过期/越窗异常条**）；周期与复权声明；免费徽章；进度与版本校验。流程：`p_view` / `x_expired` |
| [student-class](student-class.html) | S7 互动课堂（本地 TTS·白板标注同步·随堂测验本地评分·复习清单）；**不耗额度**徽章。流程：`s_keep` |

### 运营端 · 控制台（ops-*，浅色 · 与门户族统一）

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [ops-models](ops-models.html) | B1 · Tabs（对齐 ai-invest）：模型条目（冷却/最后测试/行内测试编辑删除）+ 任务模型（槽位式主备·备用≠主）+ ASR 渠道（Descriptions 卡·热词注入术语表） |
| [ops-usage](ops-usage.html) | B3 非功能 · 仪表盘（对齐 ai-invest）：Statistic 统计卡 + 日消耗柱状 + 预算 80%/100% + 按任务/按模型分布（占比条）+ 明细（sparkline·主备健康）+ 来源/时间筛选 |
| [ops-accounts](ops-accounts.html) | B1/流程 `ops_account` · 标准用户表格（对齐 ai-invest）：状态分段 + 搜索/角色筛选 + 角色徽章 + 剩余额度/累计消耗 + 行内操作 + 分页 + 新建账号 Modal（邀请码一次性） |
| [ops-publish](ops-publish.html) | B4：就绪度五项条件、签批（指纹/幂等/审批记录）、发布五步（迁移先行/回滚）、发布历史。流程：`ops_signoff` / `ops_publish` |

打磨记录：R1 全量生成（10 页）→ R2 正向覆盖审核补 3 缺口 → R3 反向审核补需求（教师 v0.3 五项 + 学员周期声明）→ R4 复审补齐 8 页（2026-11-11）→ **R5 v4 重构**（2026-11-11：拆 8 页双文档拼接、修复 dsh 字体简写与门户未定义变量、共享底座 tokens/family-\*、全站导航接线、新增体系页与原型索引、运行图注入跳转）→ **R6 门户族按 trend-studio 实现移植**（2026-11-11：首页/登录/注册/设备授权/个人中心/落地页对齐已实现 portal——portal-header 导航、home-hero 五段结构、page-hero + auth-card 认证版式、account-grid 双列面板、浅色 portal-footer；BYOK 旧文案已按 ADR-03 调整为云端供给）→ **R7 落地页转型**（2026-11-11：landing-course 课程落地页改为 landing-features 站点功能落地页——少文字、每能力配纯 CSS/SVG 产品视觉 mockup，图文交替 + bento；门户导航「交易体系」改指页内 #system 体系概览）→ **R8 信息架构收敛**（2026-11-11：独立落地页删除、能力图文并入主页 portal.html；`student-portal/login/register/device-auth/account` 更名 `portal-*`；**student-\* 仅保留 dsh 客户端五页**（setup/system/chat/course/class）；全站引用与运行图注入映射同步更新）。**R9 课件目标效果移植**（2026-11-11：student-course 内容区按 trend-studio「教材呈现原型」section-preview.html 重做——.cw 课件子系统固定深色、自带 token，含标注/回放/画中画/对比滑块/滚动叙事等全部交互；teacher-review 逐节预览对齐块清单并互链）。**R10 教师端 Agent 化重设计**（2026-11-11：对齐 deepagents 与业界 Agent UI；新增 teacher-login 分屏入口）。**R11 教师端改回课程主视角**（2026-11-11）。**R12 旅程式极简重构**（2026-11-11：仍嫌复杂 → 四阶段收敛为「素材与方案 → 逐节生产 → 成品审核 → 交接运营」单列纵向旅程，仅当前阶段展开、其余折叠一行；需要教师处理的事项以告警条呈现且影响面先展示；Agent 细节/完整方案/引擎规则全部折叠；我的课程退化为极简列表；运行图 c_upload/c_pipeline/h_trigger 映射移至 teacher-plan）。**R13 运营端并入门户族**（2026-11-11：色板统一为浅色门户）。**R14 运营端改为后台管理布局**（2026-11-11：ops-* 四页按 admin 常见 UI/UX 重排——左侧固定侧栏（品牌 + 分组菜单 + 用户卡）+ 顶栏面包屑 + PageHeader（标题/说明/筛选与主操作）+ 面卡表格（分页器/筛选器），色板仍为门户浅色（蓝 #2563eb）；新增 assets/family-ops.css 底座，复用 family-portal 组件）。**R17 课程制作流程对齐线上实现**（2026-11-11：按 trend.17aitech.com 已部署的 trend-studio admin 迁移——课程内容改主从页（左课程列表搜索/状态筛选 + 右课程信息/发布就绪度门禁行/课程结构章节折叠·知识点列表）；素材与方案改视频建课管线（横向 Steps + AssetTable 素材行）；生产看板完整迁移（汇总标签 + 流程向导竖向九步·契约同源 goal/tools/pitfalls + 九步进度表·任务状态·产出·评审·当前步 + 追加素材决策行）；成品审核就绪度改门禁行样式）。**R16 教师端统一浅色**（2026-11-11：teacher-* 五页由深色控制台改为与 portal/ops 同族——登录页改门户分屏版式，四页复用 ops shell（侧栏/顶栏/面卡）+ 门户色板；旅程/告警/节卡片/计划卡/rubric 组件出浅色版 family-teacher.css；family-admin.css 深色底座移除）。**R15 对齐 ai-invest 运营页**（2026-11-11：参考 ai-invest-assisstant Admin——模型配置改 Tabs（模型条目含冷却/最后测试列与行内测试编辑删除 · 任务模型槽位式主备表单 · ASR 渠道 Descriptions 卡）；账号管理改标准用户表格（状态分段 + 搜索/角色工具栏 + 角色徽章 + 剩余额度/累计消耗 + 行内操作 + 分页 + 新建 Modal）；用量改 Statistic 统计卡 + 日消耗柱状 + 按任务/按模型分布占比条 + 明细表 sparkline）。**R18 教师端 Agent 原生重设计**（2026-11-11：门禁不再是独立菜单，改为对话内决策卡；教师四页统一三栏 + 常驻 Agent rail（对话/执行/产物）；新增 `family-agent.css`；补齐 deepagents 常见交互——todo 计划、工具调用卡、子代理树、HITL interrupt、产物树、流式与上下文计量；对齐业界 Agent UI 实践——单一主行动、渐进披露、状态语义、空/错误态；教师侧移除签批/发布/生成索引入口，交接改为只读）。**R19 教材编辑入口可见化**（2026-11-11：评审反馈「找不到从哪开始编辑教材」——侧栏「工具」新增**教材编辑**；工作台课程头加「编辑教材」、课程头下新增**内容编辑**四入口卡（教材正文/节元数据/案例股与术语/图示课件），章节行「教材」改为跳转；新增 `teacher-textbook.html`——三法入口（Agent 改正文 / 结构化编辑 / 重新生成）、只读 DSL 预览与段级「改这段」、修改记录、Agent diff 与三层校验；生产已完成节、审核预览补教材入口）。**R20 制作主线五段化**（2026-11-11：评审要求「上传 → 转写 → 大纲 → 资产 → 编排预览」端到端可见——新增 `teacher-material.html`（大拖拽上传、转写管道、ASR 逐字稿、关键帧）、`teacher-assets.html`（类型 Tab + 表格 CRUD + K 线图结构化编辑 + 批量生成 HITL）、`teacher-compose.html`（区块画布 + 学员视图预览）；`teacher-plan` 收敛为大纲页并支持对话内微调；教师侧栏统一按制作主线分组，工作台新增五入口卡；`family-agent.css` 增补子导航、内容 Tab、转写管道、ASR、关键帧、资产表、编排画布组件）。 **R21 信息密度收敛**（2026-11-11：评审反馈「信息元素太多、抓不住重点」，参照 SasanImmersive 原型——侧栏只保留 4 阶段 + 2 工具（无二级菜单），删四段阶段条改用**页内阶段 Tab**（上传与转写/课程大纲；内容资产/逐节生产/编排预览）；工作台五入口改单行、内容编辑压成一行、健康度 5 行减到 3 行；资产页删左章节树与告警条、表格全宽、K 线编辑默认折叠；编排页删左节树、节与模板收进工具栏；大纲页素材卡压成一行、术语图谱折叠；顶栏删搜索/铃铛）。 **R22 二次密度收敛**（2026-11-11：评审再次反馈「信息/文字元素太多、难理解」并要求去掉「门禁①/②」字样——工作台删课程筛选/设置块/说明句，主线改单行五步；大纲页删版本 chips/证据/行内动作，改 `.oe-row.slim`；资产页工具栏只留搜索、行内只留两项操作；编排页删区块动作按钮；逐节生产删双列元数据、失败详情默认折叠、新素材决策压成三选一；审核页删重复说明/详情链接/导出按钮；全部页面把「门禁①/②/五门禁」改写为「大纲确认 / 审核决定 / 五项条件」，学生端与运营端同步）。 **R23 大道至简：两页工作区**（2026-11-11：评审提出整个工作区只要「原始数据、生成结果、生成它的 Agent 对话」——教师工作台改为两页：`teacher-material` 更名**原始数据**（上传 → 解析 → 逐字稿 → 关键帧），`teacher-textbook` 重做为**教材**（左章节/单元结构树 + 中渲染后的 HTML 教材 + 右 Agent 生成侧栏：todo / 工具调用 / skill 调用 / 流式输出 / HITL / HTML 产物树）；侧栏收敛为「所有课程 / 原始数据 / 教材 / 用量与成本」；`teacher-workbench` 重做为极简课程卡列表且去掉 Agent rail；旧五页（大纲/资产/逐节生产/编排/审核）保留文件但退出主导航，索引与 README 标注为参考）。
