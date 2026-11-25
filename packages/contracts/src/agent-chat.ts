import { z } from 'zod'
import { idShape } from './ids.js'

/**
 * Agent 对话式交互（arch/08，教师端需求 T7/T8/T11/T21）：
 * 方案页与制作台统一的中置对话——真多轮会话 + AskQuestion 确认卡 + TODO 卡。
 * 红线：确认类动作不经模型执行——「批准」等由服务端按用户所选选项
 * 确定性调用既有端点，模型侧没有对应工具。
 *
 * 消息按 role 判别，只追加不更新（唯一例外：question 的 answeredIndex
 * 由答案处理器回写一次）；流式读取按 seq 增量游标，SSE 事件流优先、
 * 断线降级增量轮询。
 */

export const agentPhase = z.enum(['plan', 'production'])

/** TODO 卡单项（agent 标准 todo：pending / doing / done）。 */
export const agentTodoItem = z.object({
  content: z.string().min(1).max(200),
  status: z.enum(['pending', 'doing', 'done']),
})

/** AskQuestion 确认卡的选项：标签 + 一句说明。 */
export const agentQuestionOption = z.object({
  label: z.string().min(1).max(60),
  description: z.string().max(300).nullable(),
})

/** assistant 消息内联的工具事件组（只记事实：调了什么、多久、成没成）。 */
export const agentToolEventView = z.object({
  name: z.string().min(1),
  argsSummary: z.string().max(300),
  latencyMs: z.number().int().min(0).nullable(),
  status: z.enum(['ok', 'err']).nullable(),
})

const agentMessageBase = z.object({
  id: z.string().regex(idShape.agentMessage),
  threadId: z.string().regex(idShape.thread),
  /** 增量游标（线程内单调递增）。 */
  seq: z.number().int().min(1),
  createdAt: z.string(),
  /** 产生该消息的模型调用账目（event/todo 可空）。 */
  aiRunId: z.string().regex(idShape.aiRun).nullable(),
})

export const agentMessageView = z.discriminatedUnion('role', [
  agentMessageBase.extend({ role: z.literal('user'), text: z.string().min(1).max(2000) }),
  agentMessageBase.extend({
    role: z.literal('assistant'),
    text: z.string(),
    tools: z.array(agentToolEventView).max(20),
  }),
  agentMessageBase.extend({
    role: z.literal('question'),
    question: z.object({
      text: z.string().min(1),
      options: z.array(agentQuestionOption).min(2).max(6),
      /** 已回答时回写所选下标（前端据此锁定并高亮）；未回答为 null。 */
      answeredIndex: z.number().int().min(0).nullable(),
    }),
    /**
     * 发起方分流键：'agent' = 模型经 ask_question 工具中断发起（真中断，
     * 引擎以 Command(resume) 续跑，防过期回答 409）；'server' = 服务端补发
     * （批准卡/停止接续卡，选项可绑确定性动作）。存量数据无此字段按 server。
     */
    source: z.enum(['agent', 'server']).nullish(),
  }),
  agentMessageBase.extend({
    role: z.literal('answer'),
    /** 被回答的确认卡消息。 */
    questionMessageId: z.string().regex(idShape.agentMessage),
    optionIndex: z.number().int().min(0),
    label: z.string().min(1),
    /** 教师点选时附带的自由文本说明（「填写其他想法」），可空。 */
    note: z.string().max(1000).nullish(),
  }),
  agentMessageBase.extend({
    role: z.literal('todo'),
    /** 卡片标题（九步 TODO 卡=节标题）；无标题的通用任务清单为 null/缺省。 */
    title: z.string().min(1).max(200).nullish(),
    /** 始终渲染线程内最新一份 todo；旧 todo 由前端折叠。 */
    items: z.array(agentTodoItem).min(1).max(12),
  }),
  agentMessageBase.extend({
    role: z.literal('event'),
    /** 系统事实的判别键（如 plan_drafted / approval_blocked / run_failed / stop_done）。 */
    kind: z.string().min(1),
    detail: z.string().max(500).nullable(),
    level: z.enum(['info', 'ok', 'err']),
  }),
])

export const sendMessageRequest = z.object({
  /** 上限 20000：目录先验可整段粘贴进对话（与旧起草表单同量级）。 */
  text: z.string().min(1).max(20000),
})

export const sendMessageResponse = z.object({
  /** 回显落库后的 user 消息（含 seq）；agent 回复经流端点增量到达。 */
  message: agentMessageView,
})

export const answerQuestionRequest = z.object({
  optionIndex: z.number().int().min(0),
  /** 附带的自由文本说明；与所选选项一起回显并进入模型上下文。 */
  note: z.string().max(1000).optional(),
})

export const answerQuestionResponse = z.object({
  /** 回显落库后的 answer 消息；确定性动作结果以 event 消息经流端点到达。 */
  message: agentMessageView,
})

export const stopAgentRunResponse = z.object({
  /** true = 已对在途对话任务发出取消请求（引擎在轮边界安全中止并落事件）。 */
  stopped: z.boolean(),
})

export const agentStreamResponse = z.object({
  /** 自 cursor 起的新消息（首拉为空 cursor 时给全量）。 */
  messages: z.array(agentMessageView),
  /** 增量游标：下次带回来只取 seq 更大的消息。 */
  cursor: z.number().int().min(0),
  /** 该线程是否有在途 agent run（驱动 typing 态）。 */
  agentBusy: z.boolean(),
  /** 未回答的确认卡消息 id；有值时右栏「去对话处理」可定位。 */
  pendingQuestionId: z.string().regex(idShape.agentMessage).nullable(),
})

export type AgentPhase = z.infer<typeof agentPhase>
export type AgentTodoItem = z.infer<typeof agentTodoItem>
export type AgentQuestionOption = z.infer<typeof agentQuestionOption>
export type AgentToolEventView = z.infer<typeof agentToolEventView>
export type AgentMessageView = z.infer<typeof agentMessageView>
export type SendMessageRequest = z.infer<typeof sendMessageRequest>
export type SendMessageResponse = z.infer<typeof sendMessageResponse>
export type AnswerQuestionRequest = z.infer<typeof answerQuestionRequest>
export type AnswerQuestionResponse = z.infer<typeof answerQuestionResponse>
export type AgentStreamResponse = z.infer<typeof agentStreamResponse>
export type StopAgentRunResponse = z.infer<typeof stopAgentRunResponse>
