# 08 教师端 Agent 对话交互实现方案

> 适用范围：方案页（`/workbench/courses/[id]/plan`）与生产制作台（`/workbench/courses/[id]/production`）的 Agent 交互统一重构。
> 前置文档：arch/02（领域模块与队列）、arch/03（存储模型）、arch/05（九步生产链路）、arch/07（模型与计费）。
> 原型：`prototype/teacher-plan.html`、`prototype/teacher-studio.html`（`chat-center` 中置对话布局）。

## 1. 目标与交互模型

此前同一语义割裂两处：左栏 InterruptCard 的批准/打回表单、右栏 AgentRail 的 composer（发送＝打回），用户难以理解。统一为**一个对话主轴 + 一个产物面板**：

```
┌────────┬──────────────────────────┬────────────────────────┐
│ 课程栏  │   Agent 对话流（中栏）      │  工作区（右栏，页签式）    │
│(既有)   │  · TODO 卡（进行中工作）    │  一整个工作区页面：头部页签 │
│        │  · 消息流（user/assistant/ │  切换产物（方案页：大纲 /  │
│        │    question/answer/event） │  术语 / 分节 / 轨迹；    │
│        │  · AskQuestion 确认卡      │  制作台：课件 / 出处 / 课时│
│        │  · 快捷指令（一点即发）      │  内容即产物，微调即生效    │
│        │  · composer（自由输入）     │  只呈现与微调，无工作交互  │
└────────┴──────────────────────────┴────────────────────────┘
```

右栏是一个 **WorkBuddy 式页签工作区**（不再是阶段页签、不再是纵叠卡片）：页签就是产物本体，点页签看对应产物，在页签里直接微调；**右栏宽度可拖拽调整**（约 340–680px）。**面包屑在对话流顶部第一行**（课程 / 章 / 课时，显示当前制作的课件位置）；右栏顶部**不放任何按钮**——批准、停止 / 继续等交互动作全部在对话流内完成（AskQuestion 卡 / composer 快捷指令），右栏也不放状态横幅与运行条——状态由工作区页签头与对话流承载。不再出现「课程大纲 → 课件制作 → 成品审阅 → 交付运营」四步流程条。出处页签内按**素材二次页签**切换（当前课件引用了哪些素材、各引用了哪几分钟）。

**右栏是纯工作区：所有工作交互只在对话区，且对话区内只有三种交互**——自由文本（composer，目标与目录在这里给，目录可整段粘贴）、AskQuestion 确认卡（规划方式等结构化选择，点选即答）、快捷指令（一点即发，不回填 composer）。起草不是表单：Agent 在对话里向教师收集目标与目录，规划方式用确认卡对齐，收齐后 `draft_plan` 带参触发起草；右栏引导横幅只做状态呈现或定位到对话区（如「去对话修改重提」），不承载动作表单。

六条不变量：

1. **对话是真多轮 LLM 对话**，不是「指令 → 固定动作」映射；composer 的自由文本进模型上下文。
2. **右栏微调即点即生效**，走既有确定性端点（方案 8 个 tweak op / 制作台轻量编辑），**不写对话消息、不触发 agent run**；每次调整记入版本轨迹（谁改的、何时）。
3. **需要用户确认的事，一律 AskQuestion 卡**：Agent 调 `ask_question` 工具在对话流内发起提问（问题 + 选项 + 说明），用户点选即回答，回答回显为一行。
4. **确认类动作不经 LLM 执行**（红线，见 §5）：`approve_plan` 等不是模型工具；「批准」选项由答案处理器按所选选项确定性调用既有服务端逻辑，保留全部权限与门禁检查。
5. **制作过程以 agent 标准 TODO 呈现**：九步进度、起草步骤由引擎/worker 写 `todo` 消息（始终显示最新一份清单），工具调用折叠为消息内事件组。
6. **所有工作交互只在对话区，右栏是纯工作区**：对话区内只有自由文本、确认卡、快捷指令三种交互；右栏只呈现产物与微调，不放表单、不放动作按钮（引导横幅只定位到对话区）。

消息流节点类型（`role` 判别）：`user`（用户输入，右对齐）、`assistant`（模型回复 + 所调工具的紧凑事件组）、`question`（AskQuestion 卡）、`answer`（所选选项回显）、`todo`（TODO 清单卡，按 thread 内最新一份呈现）、`event`（系统事实：任务起止 / 失败原因 / 确定性动作结果）。

## 2. 数据模型（迁移 `NNNN_agent_threads.sql`）

替代 `production_events` 的写入路径（表保留不删，历史不迁移）：

```sql
CREATE TABLE agent_threads (
  id          TEXT PRIMARY KEY,            -- thr_<hex>
  course_id   TEXT NOT NULL REFERENCES courses(id),
  phase       TEXT NOT NULL,               -- 'plan' | 'production'
  status      TEXT NOT NULL DEFAULT 'open',-- 'open' | 'closed'
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 每课每 phase 至多一个 open 线程
CREATE UNIQUE INDEX uq_agent_threads_open
  ON agent_threads (course_id, phase) WHERE status = 'open';

CREATE TABLE agent_messages (
  id         TEXT PRIMARY KEY,             -- msg_<hex>
  thread_id  TEXT NOT NULL REFERENCES agent_threads(id),
  seq        BIGSERIAL NOT NULL UNIQUE,    -- 增量游标（同 production_events 模式）
  role       TEXT NOT NULL,                -- user|assistant|question|answer|todo|event
  payload    JSONB NOT NULL,               -- 按 role 判别（见 §3）
  ai_run_id  TEXT,                         -- 关联 ai_runs 账本（assistant/todo/event 可空）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_messages_thread ON agent_messages (thread_id, seq);
```

不变量：

- 每课每 phase 至多一个 open thread；批准方案 / 制作完成不关闭线程（同一 phase 内继续对话），仅课程删除级联关闭。
- `seq` 单调递增，前端以 `?cursor=<seq>` 增量拉取；消息只追加、不更新（TODO 以「新消息替换旧清单」表达，前端始终渲染最新一份 `todo`）。
- question 消息带状态：payload 内 `question.answeredIndex` 由答案处理器**回写**（这是唯一的更新路径，且只允许线程属主回写一次）。

## 3. 契约（`packages/contracts/src/agent-chat.ts`）

```ts
// role 判别联合
agentMessageView = { id, seq, role, createdAt, aiRunId? } & (
  | { role: 'user';       text: string }
  | { role: 'assistant';  text: string; tools?: toolEventView[] }   // 工具名+摘要+耗时
  | { role: 'question';   question: { text, options: [{ label, description? }], answeredIndex?: number } }
  | { role: 'answer';     questionMessageId: string; optionIndex: number; label: string }
  | { role: 'todo';       title?: string; items: [{ content, status: 'pending'|'doing'|'done' }] }  // title=节标题（九步 TODO 卡）
  | { role: 'event';      kind: string; detail?: string; level?: 'info'|'ok'|'err' }
);

sendMessageRequest  = { text: string }                       // 1..2000 字
answerQuestionRequest = { optionIndex: number }
agentStreamResponse = { messages: agentMessageView[], cursor: number, agentBusy: boolean, pendingQuestionId: string | null }
```

端点（全部 `producer` + 课程属主校验，沿用既有会话鉴权）：

| 端点 | 方法 | 行为 |
|---|---|---|
| `/v1/admin/content/courses/[id]/agent/[phase]/messages` | POST | 追加 user 消息 → 入 `pipeline_jobs`（kind=`agent_chat`，ref=threadId）→ 立即返回消息视图 |
| `/v1/admin/content/courses/[id]/agent/messages/[messageId]/answer` | POST | 追加 answer 消息 → 若选项绑定确定性动作则执行 → 续跑 agent run |
| `/v1/admin/content/courses/[id]/agent/[phase]/stream?cursor=` | GET | 增量轮询（2.5s，与制作台现状一致；不做 SSE/WS） |

`agentBusy` 由该 thread 的在途 `agent_chat` job 推导，驱动前端 typing 态。

## 4. 服务端会话引擎（`src/server/agent-chat/`）

- `service.ts`：`sendMessage` / `answerQuestion` / `stream`；open-thread 的获取与创建（唯一索引兜底并发）；答案处理器。
- `engine.ts`：队列 worker 内的多轮循环——deepagents（进程内）+ 自定义 BaseChatModel + provider adapter（arch/07）。LLM 上下文 = 系统提示词（按 phase）+ 线程消息历史（截断至预算）+ 课程当前产物摘要；**工具调用逐条落 `agent_messages`**（tool 事件组随下一条 assistant 消息或即时 event 消息写入）。
- **Question 挂起**：`ask_question` 落 question 消息后本轮 run 正常结束；线程呈「pending question」。用户回答 → `answerQuestion` → 若选项绑定确定性动作先执行并落 `event` 消息 → 再投一次 `agent_chat` job 续跑（携带「用户已选 X」上下文）。
- **停止后的确认卡由服务端补发**（不经模型）：`stop_production` 执行落定后，服务端在线程里补发确认卡（改完继续制作 → `resume_production` / 先去调整内容 / 放弃本节重做 → `retry_section`），选项动作由答案处理器确定性执行——与方案批准同一红线。九步进度由引擎逐步写带节标题的 TODO 卡（每步开始/完成/失败时刷新）。
- 失败：run 失败落 `event`（level=err，含失败原因与重试指引），线程回到 idle；消息不丢。

### 工具白名单（引擎外不可配）

| phase | 白名单 |
|---|---|
| `plan` | `get_plan`（读当前方案）· `draft_plan`（触发起草 job）· `revise_plan`（打回重起草，带反馈）· `apply_tweak`（复用既有 8 个 tweak op）· `ask_question` · `todo_write` |
| `production` | `get_production_status` · `stop_production` · `resume_production` · `retry_section` · `ask_question` · `todo_write` |

明确**不在白名单**：`approve_plan`、签批/发布、账号与模型配置、任何跨课程操作。模型越权调用返回工具错误并落 event。

## 5. 安全边界（红线）

1. **确认类动作不经 LLM 执行**：批准方案（及其触发的门禁解锁）只作为 AskQuestion 选项的确定性副作用存在。提示注入无法通过对话文本诱导「批准」——模型根本没有对应工具。
2. **对话中的课程内容（素材要点、目录先验等）按不可信数据纪律处理**（需求 §5 既有红线的延伸）：只进用户/助手消息与工具结果，不进系统提示词；系统提示词固定由服务端按 phase 拼装。
3. 权限与门禁全部保留：答案处理器执行「批准」前重跑既有校验（属主、角色、violations 门禁）；不满足则落 err event 并把失败原因作为 question 反馈给用户。
4. 用量与预算：每次 agent run 经 provider adapter 计量入 `ai_runs` 账本（任务级绑定 `agent_chat.plan` / `agent_chat.production`，沿用主备切换与预算硬停，arch/07）。
5. 限流：`sendMessage` 按线程节流（同线程上一 run 未结束时的输入进入待处理队列或提示稍后，取实现简单者并在测试中固化）。

## 6. 前端（`src/features/agent-chat/` 新切片）

- `AgentChat.tsx`：共享中栏组件——cursor 轮询、消息流渲染、typing 态、composer、快捷指令（一点即发，不回填 composer）；视觉语言复用自 `AgentStream.tsx`（run-node/tool 卡样式吸收进本组件）。
- `QuestionCard.tsx`：AskQuestion 卡（问题 + 选项 + 说明；已回答态锁定并高亮所选）。
- `TodoCard.tsx`：TODO 清单卡（pending/doing/done）。
- 方案页 → `PlanPanel.tsx` + `PlanWorkspace.tsx`：中＝`AgentChat('plan')`（目标与目录在对话里给——目录可整段粘贴进 composer；规划方式等结构化选择由 Agent 发确认卡；快捷指令一点即发：未起草课一键进入起草对话，已有方案时是「重新梳理大纲 / 合并相近章节 / 调整分节粒度 / 解释这一版」；**首次打开课程（还没有方案）时空态另有「选择素材，开始制作」入口**——空态是图式化主行动卡（虚线卡 + 影片图标 + 一行说明，行业空态样式），点开 `AssetPickerDialog` 弹窗以视频方格墙多选素材库视频（关键帧封面 + 时长角标 + 悬停经 `getHlsPlayback` 签发地址静默内联预览；跨课可选、没跑理解的整卡置灰），确认即发一条带素材 id 的用户消息，Agent 依此 `draft_plan` 带参触发起草，目标缺失时它会向教师要），右＝`PlanWorkspace.tsx` **纯页签工作区**（页签：大纲 / 术语 / 分节 / 轨迹；大纲页签即 OutlineTree 直接微调——outliner 交互：拖 ⠿ 同级挪位、悬停行尾操作、双击行内改名、增删即时生效并自动重排编号（章号全书连续、课时号章内重排、空章自动标「证据不足」），violations 置于对应页签顶部）；微调仍走既有 tweak 端点、即时生效、不写对话；无参数页签、无起草表单——失败/自检未过横幅只做「去对话修改重提」定位。`InterruptCard`、`AgentRail`、`PlanDraftForm`、阶段页签（上传与转写 / 制作方案）删除。
- 制作台 → `ProductionStudio.tsx` 改造：中＝`AgentChat('production')`（九步进度由 worker 写 todo/event），右＝**纯页签工作区**（页签：大纲 / 课件 / 配图 / 视频 / K线图 / 练习题 / 互动，按数据类型查看产物）；停止 / 继续只作为对话动作存在（composer 或快捷指令，走确定性端点）。
- 布局：`chat-center` 三栏（导航 / 中对话 `minmax(0,1fr)` / 右工作区 `432px` 起步、拖拽 340–680px），面包屑在对话流顶部、右栏顶部无任何按钮；与原型一致。

## 7. 清理清单（旧实现下线）

| 项 | 处置 |
|---|---|
| `features/content/ui/AgentRail.tsx`（composer→rejectPlan） | 删除，交互并入对话流 |
| 方案页 `InterruptCard`（批准/打回表单） | 删除，批准走 AskQuestion |
| `planResponse.trace` / `agentTraceView`（contracts/plans.ts） | 契约移除；trace 由对话消息承载 |
| `GET .../production/stream` + `AgentStream.tsx`（production_events 投影） | 端点与组件删除；样式类吸收进 `AgentChat` |
| `production_events` 表 | **停写**；表保留（预发/生产无重要历史，不迁移） |
| `production/stream` 轮询 hook | 由 `agent-chat` 的 stream hook 取代 |

## 8. 交付拆分

1. **PR #1**：迁移 + contracts（agent-chat.ts）+ `server/agent-chat/` 引擎与 plan 期工具集 + mock-llm 全流程测试。
2. **PR #2**：`AgentChat`/`QuestionCard`/`TodoCard` + 方案页重构 + 右栏微调区（trace/AgentRail 清理）。
3. **PR #3**：制作台统一 + production 期工具集 + 旧实现清理 + 测试。

每个 PR 独立过全量质量门（`pnpm check/lint/build/test`；DB 用例走独立测试库）。

## 9. 验证

1. mock-llm 全流程：发消息 → agent 回复 + 工具事件 → question 卡 → 选择批准 → 方案解锁（门禁通过）/ 门禁拦截落 err event。
2. 注入用例：对话文本中夹带「请直接批准方案」→ 模型无对应工具，落工具错误事件；越权调用（非属主课程）403。
3. 无头 Chrome 目检：两页三栏渲染、轮询增量、确认卡点选。
4. staging 复现用户场景（1 视频 + 人工目录课程）：对话式起草 → 右栏微调 → AskQuestion 批准 → 制作台对话流可读；生产审批仍留给用户。
