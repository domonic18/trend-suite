# 原型图（design/）

生产级静态原型：单文件 HTML、内联样式、可直接打开。命名 `teacher-*`（教师工作台，浏览器）/ `student-*`（学员端，门户 + dsh 客户端窗口 chrome 体现 harness 形态）。**原型为非契约材料**：评审采纳的结论须回写 requirement/ 与 arch/（已按三轮打磨回写至教师端 v0.3 / 学员端 v0.2）。

## 设计语言（v3 对齐 trend-studio 已实现风格，2026-11-11）

对齐源：`trend-studio/apps/cloud/src/portal/styles.css` 与 `admin/styles.css + App.tsx 主题令牌`。

- **门户族（学员官网/落地/注册/登录/设备授权/个人中心）**：蓝 `#2563eb` 主色 + 绿 `#0f9d76` 点缀；毛玻璃吸顶导航 + 活性胶囊；径向渐变 hero（蓝绿柔光）+ kicker 胶囊 + 四格数据卡；三/四列能力卡（卡片投影 `0 18px 48px`）；双列大数字步骤路径；深蓝渐变 CTA 带（`#11203d → #1d3b74`）；页宽 `min(1160px, 100vw−48px)`。
- **工作台族（教师 4 页 + 运营 4 页）**：admin 深色控制台——底 `#0c0e12`、面板 `#111318`、边 `#23262f/#20242e`、主色靛紫 `#5e6ad2`（Linear 风）、8px 圆角；侧栏品牌区（32px 圆角 9 方标）+ 菜单 + 底部用户卡；状态色点（ok 绿 / run 靛 / warn 琥珀 / err 粉）。
- **dsh 客户端族（会话/课程页/课堂/首启）**：石墨三栏桌面客户端窗口 chrome，引用等宽芯片，额度细计量条——保持独立，不与 Web 端混同。
- 行情图表红涨绿跌（`#e05d68/#31a984` 深色底）；全程零 emoji，16px 线性 SVG 图标。

## 页面清单与需求覆盖

| 原型 | 覆盖需求 / 流程节点 |
|---|---|
| [teacher-workbench](teacher-workbench.html) | B1 预置模型横幅·账号；B2 直传（≤2GiB·断点）·增量转写·source units；**触发方案制作**（选集/目标/目录先验+预检）；建课；课程卡 |
| [teacher-plan](teacher-plan.html) | 门禁① 方案确认**三动作**（批准/微调/打回）+ 版本历史；目录先验校验；概念图谱·术语表；**异常：提纲与素材不匹配**（修订/补素材）；综合 Agent 说明 |
| [teacher-production](teacher-production.html) | 九步引擎（顺序强制·状态九格）；逐节子代理并行；断点续跑；**异常：证据不足挂起**（补素材恢复）；回灌中（2/3）；**追加素材三选一**（影响面先算）；**人工待办**（回灌超限·概念冲突）；流程向导 |
| [teacher-review](teacher-review.html) | 评审 Agent rubric 自评；就绪度五门禁+指纹；**成品审核决策点**（通过/打回）；签批归运营（按钮隐藏）；富媒体逐节预览；**结构化编辑三抽屉**（术语抽屉可视化·归档可逆） |
| [student-portal](student-portal.html) | S1 注册·赠额；定价与计费边界；S2 一键安装包下载；充值档位；ADR-03 零配置说明 |
| [student-setup](student-setup.html) | S3 首启**仅一步登录**（设备码·授权页自动打开·赠额到账）；dsh 客户端窗口 chrome |
| [student-chat](student-chat.html) | S4 提问·云端推理带引用·segmentId 回跳；额度 pill 透明扣减；**额度耗尽**（充值入口·浏览照常）；**空召回拒答**（最近知识点）；S6 语音 ≤60s·**自动上下文本机开关**；dsh 三栏（会话/对话/伴学 tab） |
| [student-course](student-course.html) | S5 富媒体课程页（警示卡/片段卡/案例股 K 线 SVG·周期声明·事件锚点/逐根回放）；签名播放（窗校验·水印·**过期/越窗异常条**）；免费徽章；进度与版本门禁 |
| [student-account](student-account.html) | S8 额度中心（余额/明细不含问题原文/充值/防重复加额）；设备管理解绑；隐私开关；改密注销 |
| [student-class](student-class.html) | S7 互动课堂（本地 TTS·白板标注同步·随堂测验本地评分·复习清单）；**不耗额度**徽章 |

| 学员 · 注册 | [student-register](student-register.html) | S1 注册（独立页）：用户名/密码校验、赠额提示、协议勾选、防刷限流说明 |
| 学员 · 登录 | [student-login](student-login.html) | S1 登录：本机保留登录态、忘记密码走管理员重置、设备授权提示 |
| 学员 · 设备授权页 /device | [student-device-auth](student-device-auth.html) | 流程节点 `c_auth` 落地界面：四格用户码核对、登录并批准、不一致警示、10 分钟时效 |
| 学员 · 课程落地页 | [landing-course](landing-course.html) | 官网转化路径：课程元信息、六节目录卡、正文试读（警示块/板书引用/案例股缩略）、注册 CTA |
| 运营 · 模型配置 | [ops-models](ops-models.html) | B1：LLM/VLM/ASR/Embedding 条目（密钥加密掩码、连通性测试）+ 任务级主备绑定 + 冷却说明 |
| 运营 · 模型用量 | [ops-usage](ops-usage.html) | B3 非功能：汇总指标带、按任务/按模型维度、来源筛选（教师生产/学员问答）、成本估算与未配置口径、对账说明 |
| 运营 · 发布交接 | [ops-publish](ops-publish.html) | B4：就绪度五门禁、签批（指纹/幂等/审批记录）、发布五步（迁移先行/回滚）、发布历史 |
| 运营 · 账号管理 | [ops-accounts](ops-accounts.html) | B1/流程 `ops_account`：账号列表（角色/状态/设备）、建 producer 账号（邀请码一次性显示）、安全口径 |

打磨记录：R1 全量生成（10 页）→ R2 正向覆盖审核补 3 缺口 → R3 反向审核补需求（教师 v0.3 五项 + 学员周期声明）→ R4 复审补齐 8 页（注册/登录/设备授权/落地页/模型配置/模型用量/发布交接/账号管理，2026-11-11）。
