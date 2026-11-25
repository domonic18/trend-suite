import 'server-only'
import {
  AIMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages'
import { BaseChatModel, type BaseChatModelCallOptions, type BaseChatModelParams } from '@langchain/core/language_models/chat_models'
import type { ChatGeneration, ChatResult } from '@langchain/core/outputs'
import { convertToOpenAITool } from '@langchain/core/utils/function_calling'
import { queryOne } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { openSecret } from '@/server/lib/crypto'
import {
  findBinding,
  findDefaultModel,
  findModelById,
  updateModel,
  type ModelRow,
} from '@/server/models/repo'
import { normalizeBaseUrl } from '@/server/models/service'
import {
  LlmError,
  failRun,
  finishRun,
  startRun,
  type FetchLike,
  type LlmChannel,
  type LlmPurpose,
} from '@/server/content/agents/llm'

/**
 * 生产九步的模型通道（arch/07 §9 主备切换，SP4 落产）：BaseChatModel 子类包住
 * 我们的 HTTP 调用——密钥不出服务边界、逐次落 ai_runs/ai_usage_events。
 * deepagents 只见到一个会 bindTools 的 chat model；工具 schema 由 langchain 的
 * convertToOpenAITool 归一（zod v3/v4 皆收），双协议 wire 各自序列化。
 */

/** 通道的默认调用超时；各步的真实超时由 steps.ts 的 stepTimeoutMs 给。 */
export const DEFAULT_CALL_TIMEOUT_MS = 120_000
const CALL_TEMPERATURE = 0.2
/** 通道的默认输出预算；各步的真实预算由 steps.ts 的 stepMaxTokens 给。 */
export const DEFAULT_MAX_TOKENS = 4096
/** 可重试失败后的条目冷却：主模型连续失败时备模型顶上（arch/07 §9）。 */
const COOLDOWN_MS = 60_000
/** 预算硬停（arch/05 §14）：生产端当日 token 总量上限，0/未配置 = 不限。 */
const DAILY_TOKEN_BUDGET = Number(process.env.AI_TOKEN_BUDGET_DAILY ?? 0)

export type TrendChatModelFields = {
  /** 任务键（绑定解析 + ai_runs.task_key 记账）。 */
  task: string
  purpose: LlmPurpose
  /** 记账归属（production_step → production_tasks.id）。 */
  refType: string
  refId: string
  maxTokens?: number
  /** 单次调用超时（ms）：产物越大的步越久——正文一步 1200~3000 字，120s 不够。 */
  timeoutMs?: number
  /** 测试注入：替换 fetch（协议往返单测不打真实网络）。 */
  fetchImpl?: FetchLike
}

type TrendCallOptions = BaseChatModelCallOptions & { tools?: unknown[] }

// ---------------------------------------------------------------- 候选解析（主 → 备）

export async function resolveTaskCandidates(
  task: string,
  purpose: LlmPurpose,
): Promise<LlmChannel[]> {
  const binding = await findBinding(task)
  const rows: ModelRow[] = binding
    ? await pickModels([binding.primary_model_id, binding.backup_model_id])
    : await pickDefault(purpose)
  const now = Date.now()
  const healthy: LlmChannel[] = []
  const cooling: LlmChannel[] = []
  for (const row of rows) {
    if (row.status !== 'active') continue
    const apiKey = openSecret(row.api_key_enc)
    if (!apiKey || !row.base_url) continue
    const channel: LlmChannel = {
      modelId: row.id,
      model: row.model,
      provider: row.provider,
      protocol: row.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: normalizeBaseUrl(row.base_url),
      apiKey,
    }
    // 冷却中的条目让位给健康条目；候选全冷却时仍回落使用（宁可重试冷却模型，不可无模型可用）。
    if (row.cooldown_until && row.cooldown_until.getTime() > now) cooling.push(channel)
    else healthy.push(channel)
  }
  return healthy.length > 0 ? healthy : cooling
}

async function pickModels(ids: (string | null)[]): Promise<ModelRow[]> {
  const rows: ModelRow[] = []
  for (const id of ids) {
    if (!id) continue
    const row = await findModelById(id)
    if (row) rows.push(row)
  }
  return rows
}

async function pickDefault(purpose: LlmPurpose): Promise<ModelRow[]> {
  const row = await findDefaultModel(purpose)
  return row ? [row] : []
}

// ---------------------------------------------------------------- 预算硬停

export async function assertProducerBudget(): Promise<void> {
  if (!Number.isFinite(DAILY_TOKEN_BUDGET) || DAILY_TOKEN_BUDGET <= 0) return
  const row = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(COALESCE(e.tokens_in, 0) + COALESCE(e.tokens_out, 0)), 0) AS total
     FROM ai_usage_events e
     JOIN ai_runs r ON r.id = e.run_id
     WHERE r.source = 'producer' AND r.created_at >= date_trunc('day', now())`,
  )
  if (Number(row?.total ?? 0) >= DAILY_TOKEN_BUDGET) {
    throw new LlmError('生产端当日 token 预算已触线', { retryable: false, code: 'budget_exhausted' })
  }
}

// ---------------------------------------------------------------- 双协议 wire

type OpenAiToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAiToolCall[]
  tool_call_id?: string
}

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

type WireToolCall = { id: string; name: string; args: Record<string, unknown> }

type WireCompletion = {
  text: string
  /** 思考过程（DeepSeek reasoning_content / Anthropic thinking 块）；无则 null。 */
  reasoning: string | null
  toolCalls: WireToolCall[]
  tokensIn: number | null
  tokensOut: number | null
}

function textOf(message: BaseMessage): string {
  const content: unknown = message.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

function toOpenAiMessages(messages: BaseMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = []
  for (const message of messages) {
    const text = textOf(message)
    if (message instanceof SystemMessage) {
      out.push({ role: 'system', content: text })
    } else if (message instanceof ToolMessage) {
      out.push({ role: 'tool', content: text, tool_call_id: message.tool_call_id })
    } else if (message instanceof AIMessage) {
      const toolCalls = (message.tool_calls ?? []).map((tc, index) => ({
        id: tc.id ?? `call_${index}`,
        type: 'function' as const,
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }))
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    } else {
      out.push({ role: 'user', content: text })
    }
  }
  return out
}

/** anthropic 要求 user/assistant 严格交替：同角色相邻时块合并进同一条。 */
function toAnthropicMessages(
  messages: BaseMessage[],
): { system: string; messages: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] } {
  const systemParts: string[] = []
  const out: { role: 'user' | 'assistant'; content: AnthropicBlock[] }[] = []
  let synthetic = 0
  const push = (role: 'user' | 'assistant', block: AnthropicBlock): void => {
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(block)
    else out.push({ role, content: [block] })
  }
  for (const message of messages) {
    const text = textOf(message)
    if (message instanceof SystemMessage) {
      systemParts.push(text)
    } else if (message instanceof ToolMessage) {
      push('user', { type: 'tool_result', tool_use_id: message.tool_call_id, content: text })
    } else if (message instanceof AIMessage) {
      const toolCalls = message.tool_calls ?? []
      if (text.length > 0) push('assistant', { type: 'text', text })
      for (const tc of toolCalls) {
        push('assistant', {
          type: 'tool_use',
          id: tc.id ?? `call_${synthetic++}`,
          name: tc.name,
          input: tc.args ?? {},
        })
      }
      if (text.length === 0 && toolCalls.length === 0) continue
    } else {
      push('user', { type: 'text', text })
    }
  }
  return { system: systemParts.join('\n\n'), messages: out }
}

type WireToolDef = { name: string; description: string | undefined; parameters: unknown }

function wireToolNames(tools: unknown[] | undefined): WireToolDef[] {
  if (!tools || tools.length === 0) return []
  return tools.map((tool) => {
    // convertToOpenAITool 已在 bindTools 归一；这里只防测试直接塞原始 wire。
    const openaiTool = tool as { function?: { name?: string; description?: string; parameters?: unknown } }
    if (openaiTool.function?.name) {
      return {
        name: openaiTool.function.name,
        description: openaiTool.function.description ?? '',
        parameters: openaiTool.function.parameters ?? {},
      }
    }
    const converted = convertToOpenAITool(tool as never)
    return {
      name: converted.function.name,
      description: converted.function.description,
      parameters: converted.function.parameters,
    }
  })
}

function toFetchError(err: unknown): LlmError {
  const name = (err as Error).name
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new LlmError('模型调用超时', { retryable: true, code: 'llm_timeout' })
  }
  return new LlmError(`模型连接失败：${(err as Error).message}`, { retryable: true, code: 'llm_network' })
}

function throwForStatus(status: number, bodyText: string): void {
  const snippet = bodyText.replace(/\s+/g, ' ').slice(0, 200)
  if (status === 429 || status >= 500) {
    throw new LlmError(`上游返回 ${status}：${snippet}`, { retryable: true, code: 'llm_upstream' })
  }
  if (status < 200 || status >= 300) {
    throw new LlmError(`上游返回 ${status}：${snippet}`, { retryable: false, code: 'llm_upstream' })
  }
}

function parseJsonPayload<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new LlmError('模型返回不是合法 JSON', { retryable: true, code: 'llm_bad_json' })
  }
}

// ---------------------------------------------------------------- 通道本体

export class TrendChatModel extends BaseChatModel<TrendCallOptions> {
  private readonly task: string
  private readonly purpose: LlmPurpose
  private readonly refType: string
  private readonly refId: string
  private readonly maxTokens: number
  private readonly timeoutMs: number
  private readonly fetchImpl: FetchLike

  constructor(fields: TrendChatModelFields & BaseChatModelParams) {
    super(fields)
    this.task = fields.task
    this.purpose = fields.purpose
    this.refType = fields.refType
    this.refId = fields.refId
    this.maxTokens = fields.maxTokens ?? DEFAULT_MAX_TOKENS
    this.timeoutMs = fields.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS
    this.fetchImpl = fields.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  override _llmType(): string {
    return 'trend_channel'
  }

  override bindTools(tools: unknown[], kwargs?: Partial<TrendCallOptions>) {
    // 传给上游的统一是 openai function 形态；anthropic 侧由 callAnthropic 再映射。
    const wire = tools.map((tool) => convertToOpenAITool(tool as never))
    return this.withConfig({ tools: wire, ...kwargs } as Partial<TrendCallOptions>)
  }

  /**
   * 一次 agent 调用 = 一条候选链：主失败（可重试类）→ 冷却主模型 → 备顶上。
   * 每个候选各记一条 ai_run；不可重试错误（配置缺失/预算触线）直接抛。
   */
  async _generate(messages: BaseMessage[], options: TrendCallOptions): Promise<ChatResult> {
    await assertProducerBudget()
    const candidates = await resolveTaskCandidates(this.task, this.purpose)
    if (candidates.length === 0) {
      throw new LlmError(`任务 ${this.task} 无可用模型（未绑定或全部冷却/禁用）`, {
        retryable: false,
        code: 'model_not_configured',
      })
    }
    let lastError: LlmError | null = null
    for (const channel of candidates) {
      try {
        return await this.callChannel(channel, messages, options)
      } catch (err) {
        if (err instanceof LlmError && err.retryable) {
          lastError = err
          await updateModel(channel.modelId, { cooldownUntil: new Date(Date.now() + COOLDOWN_MS) }).catch(
            () => undefined,
          )
          continue
        }
        throw err
      }
    }
    throw (
      lastError ??
      new LlmError('模型调用失败：候选链耗尽', { retryable: true, code: 'llm_internal' })
    )
  }

  private async callChannel(
    channel: LlmChannel,
    messages: BaseMessage[],
    options: TrendCallOptions,
  ): Promise<ChatResult> {
    const runId = newId('aiRun')
    await startRun({ task: this.task, refType: this.refType, refId: this.refId, channel, runId })
    const started = Date.now()
    try {
      const completion =
        channel.protocol === 'anthropic'
          ? await this.callAnthropic(channel, messages, options)
          : await this.callOpenai(channel, messages, options)
      const latencyMs = Date.now() - started
      const summary =
        completion.text.length > 0 ? completion.text : `tool_calls:${completion.toolCalls.length}`
      await finishRun({
        runId,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
        latencyMs,
        summary,
      })
      const toolCalls: ToolCall[] = completion.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        args: tc.args,
        type: 'tool_call',
      }))
      const message = new AIMessage({
        content: completion.text,
        tool_calls: toolCalls,
        ...(completion.reasoning ? { additional_kwargs: { reasoning_content: completion.reasoning } } : {}),
      })
      const generation: ChatGeneration = { text: completion.text, message }
      return {
        generations: [generation],
        llmOutput: {
          tokenUsage: {
            promptTokens: completion.tokensIn ?? 0,
            completionTokens: completion.tokensOut ?? 0,
            totalTokens: (completion.tokensIn ?? 0) + (completion.tokensOut ?? 0),
          },
        },
      }
    } catch (err) {
      const isLlm = err instanceof LlmError
      await failRun({
        runId,
        code: isLlm ? err.code : 'llm_internal',
        message: (err as Error).message,
      }).catch(() => undefined)
      if (isLlm) throw err
      throw new LlmError(`模型调用失败：${(err as Error).message}`, {
        retryable: true,
        code: 'llm_internal',
      })
    }
  }

  private async callOpenai(
    channel: LlmChannel,
    messages: BaseMessage[],
    options: TrendCallOptions,
  ): Promise<WireCompletion> {
    const toolDefs = wireToolNames(options.tools)
    const body: Record<string, unknown> = {
      model: channel.model,
      max_tokens: this.maxTokens,
      temperature: CALL_TEMPERATURE,
      messages: toOpenAiMessages(messages),
    }
    if (toolDefs.length > 0) {
      body.tools = toolDefs.map((def) => ({ type: 'function', function: def }))
    }
    let res: Response
    try {
      res = await this.fetchImpl(`${channel.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${channel.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw toFetchError(err)
    }
    const text = await res.text()
    throwForStatus(res.status, text)
    const payload = parseJsonPayload<{
      choices?: {
        message?: {
          content?: string | null
          /** DeepSeek R1 系兼容端的思考过程（部分端叫 reasoning）。 */
          reasoning_content?: string | null
          reasoning?: string | null
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }>(text)
    const message = payload.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    const reasoning =
      typeof message?.reasoning_content === 'string' && message.reasoning_content.trim().length > 0
        ? message.reasoning_content
        : typeof message?.reasoning === 'string' && message.reasoning.trim().length > 0
          ? message.reasoning
          : null
    const toolCalls: WireToolCall[] = []
    for (const [index, raw] of (message?.tool_calls ?? []).entries()) {
      const name = raw.function?.name ?? ''
      if (!name) {
        throw new LlmError('工具调用缺少名称', { retryable: true, code: 'llm_bad_json' })
      }
      const rawArgs = raw.function?.arguments
      let args: Record<string, unknown> = {}
      if (rawArgs && rawArgs.trim().length > 0) {
        try {
          args = JSON.parse(rawArgs) as Record<string, unknown>
        } catch {
          throw new LlmError('工具参数不是合法 JSON', { retryable: true, code: 'llm_bad_json' })
        }
      }
      toolCalls.push({ id: raw.id ?? `call_${index}`, name, args })
    }
    if (content.length === 0 && toolCalls.length === 0) {
      throw new LlmError('模型返回空内容', { retryable: true, code: 'llm_bad_json' })
    }
    return {
      text: content,
      reasoning,
      toolCalls,
      tokensIn: payload.usage?.prompt_tokens ?? null,
      tokensOut: payload.usage?.completion_tokens ?? null,
    }
  }

  private async callAnthropic(
    channel: LlmChannel,
    messages: BaseMessage[],
    options: TrendCallOptions,
  ): Promise<WireCompletion> {
    const { system, messages: wireMessages } = toAnthropicMessages(messages)
    const toolDefs = wireToolNames(options.tools)
    const body: Record<string, unknown> = {
      model: channel.model,
      max_tokens: this.maxTokens,
      temperature: CALL_TEMPERATURE,
      system: system.length > 0 ? system : undefined,
      messages: wireMessages,
    }
    if (toolDefs.length > 0) {
      body.tools = toolDefs.map((def) => ({
        name: def.name,
        description: def.description,
        input_schema: def.parameters,
      }))
    }
    let res: Response
    try {
      res = await this.fetchImpl(`${channel.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': channel.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw toFetchError(err)
    }
    const text = await res.text()
    throwForStatus(res.status, text)
    const payload = parseJsonPayload<{
      content?: { type?: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }[]
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
    }>(text)
    if (payload.stop_reason === 'max_tokens') {
      throw new LlmError('模型输出因 max_tokens 截断', { retryable: false, code: 'llm_truncated' })
    }
    const textParts: string[] = []
    const thinkingParts: string[] = []
    const toolCalls: WireToolCall[] = []
    let synthetic = 0
    for (const block of payload.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        thinkingParts.push(block.thinking)
      } else if (block.type === 'tool_use') {
        const name = block.name ?? ''
        if (!name) {
          throw new LlmError('工具调用缺少名称', { retryable: true, code: 'llm_bad_json' })
        }
        toolCalls.push({
          id: block.id ?? `call_${synthetic++}`,
          name,
          args: (block.input ?? {}) as Record<string, unknown>,
        })
      }
    }
    const content = textParts.join('')
    if (content.length === 0 && toolCalls.length === 0) {
      throw new LlmError('模型返回空内容', { retryable: true, code: 'llm_bad_json' })
    }
    return {
      text: content,
      reasoning: thinkingParts.length > 0 ? thinkingParts.join('\n') : null,
      toolCalls,
      tokensIn: payload.usage?.input_tokens ?? null,
      tokensOut: payload.usage?.output_tokens ?? null,
    }
  }
}
