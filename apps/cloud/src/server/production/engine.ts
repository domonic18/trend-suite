import 'server-only'
import { LlmError } from '@/server/content/agents/llm'
import { persistCaseStocks, readbackQuotes, syncQuotesForSection } from '@/server/content/quotes/service'
import * as quotesRepo from '@/server/content/quotes/repo'
import { conceptTerms } from '@/server/content/textbook/section-content'
import { parseDsl } from '@/server/content/textbook/dsl-parser'
import { validateDsl } from '@/server/content/textbook/validator'
import { persistFigures, type FigureSpec } from '@/server/content/textbook/figures-service'
import * as textbookRepo from '@/server/content/textbook/repo'
import * as widgetsRepo from '@/server/content/widgets/repo'
import { persistWidgets, replayMarketAvailable } from '@/server/content/widgets/service'
import { listSourceUnitsByCourse } from '@/server/pipeline/processing/repo'
import { runStepAgent } from './agent'
import { formatIssues, formatWidgetIssues } from './issues'
import { recordEvent, listRecordedRunIds } from './events'
import {
  completeStep,
  countSectionRuns,
  failStep,
  getTaskCheckpoint,
  listTaskRuns,
  suspendTask,
  type ProductionTaskRow,
  type SectionRow,
} from './repo'
import { stepDef, STEP_COUNT, type StepDef } from './steps'

/**
 * 步执行状态机（arch/05 §6/§7）：按 STEP_DEFS 分发 agent/pure，
 * 产物过第一层校验后 completeStep 幂等落库；失败走回灌或挂起。
 * 云端复检（第二层）：case_stocks（迭代 5）/ figure_spec 与 section_draft（迭代 6）
 * ——复检拒绝抛错即回灌（拒绝原因落 last_error，重试提示词会带回去喂模型）。
 * 顺序强制是结构性的：claimNextStep 只认领「更小步全 done」的 pending 行。
 * 行情同步/读回是 pure 步且源不可用走占位降级（步骤照常 done）——挂起只留给 agent 步。
 * 迭代 7 接入步骤 5（回放课件）与步骤 7（其余课件）：课件复检 = 物化 → 契约严校验
 * → 断言逐条程序证明 → **全过才落库**（任一断言不成立即一行不落，回灌重写）。
 */

export async function executeStep(task: ProductionTaskRow, section: SectionRow): Promise<void> {
  const def = stepDef(task.step)
  let output: Record<string, unknown> | undefined
  // 步开始即入事件流：教师端制作页据此显示「Agent 正在做什么」。
  await recordStepEvent(task, 'running', `第 ${def.n} 步「${def.label}」开始`)
  try {
    output = await runStepBody(task, section, def)
  } finally {
    // 模型调用记成工具卡：只记事实（模型、耗时、token），不记模型措辞。
    await recordToolEvents(task, def)
  }
  await completeStep(task, output)
  await recordStepEvent(task, 'done', `第 ${def.n} 步「${def.label}」完成`)
}

/** 单步执行体（产物产出 + 复检），失败抛错由调用方走回灌。 */
async function runStepBody(
  task: ProductionTaskRow,
  section: SectionRow,
  def: StepDef,
): Promise<Record<string, unknown> | undefined> {
  let output: Record<string, unknown> | undefined
  if (def.kind === 'pure') {
    // pure 步产物按步骤键入 checkpoint（读回步按键取前置产物）。
    output = { [def.key]: await runPureStep(def.key, task) }
  } else if (def.key === 'replay_widget' && !(await replayMarketAvailable(task.course_id, task.section_id))) {
    // 降级（arch/06 §5.4）：行情源不可用 → 不产回放课件，步照常 done。
    // 正文步据此不写 :::replay（步骤 6 的提示里没有可用 code）。
    output = { replay_widget: { skipped: '行情源不可用，本节无回放课件' } }
  } else {
    // 第 6 步要知道本节有没有已落库的回放课件（决定正文能否写 :::replay）。
    const replayCodes = def.key === 'section_draft' ? await replayCodesOf(task) : []
    await runStepAgent({ task, section, replayCodes })
    const checkpoint = await getTaskCheckpoint(task.id)
    if (def.key === 'case_stocks') {
      // 云端复检 + 落库（arch/06 §5.1）：结构性违例抛错走回灌，与源不可用区分。
      await persistCaseStocks(task.course_id, task.section_id, checkpoint?.[def.key])
    } else if (def.key === 'figure_spec') {
      // 图示复检 + 三路落库（arch/05 §8）：配额越界/证据不接地抛错回灌（验收③）。
      const product = checkpoint?.[def.key] as { figures?: unknown } | undefined
      const result = await persistFigures({
        courseId: task.course_id,
        sectionId: task.section_id,
        specs: (Array.isArray(product?.figures) ? product.figures : []) as FigureSpec[],
      })
      if (result.issues.length > 0) {
        throw new Error(formatIssues('图示复检拒绝', result.issues))
      }
    } else if (def.key === 'replay_widget' || def.key === 'widgets') {
      // 课件复检 + 落库（arch/06 §9/§11）：断言不成立 → 一行不落，回灌重写。
      const product = checkpoint?.[def.key] as { widgets?: unknown } | undefined
      const result = await persistWidgets({
        courseId: task.course_id,
        sectionId: task.section_id,
        drafts: Array.isArray(product?.widgets) ? product.widgets : [],
        mode: def.key === 'replay_widget' ? 'replay' : 'batch',
      })
      if (result.issues.length > 0) {
        throw new Error(
          formatWidgetIssues(def.key === 'replay_widget' ? '回放课件复检拒绝' : '课件复检拒绝', result.issues),
        )
      }
      output = { [def.key]: { persisted: result.persisted, notes: result.notes } }
    } else if (def.key === 'section_draft') {
      // 正文复检（arch/06 §2.4）：语法 → 语义全表 → 通过才写 sections.body（验收④）。
      const product = checkpoint?.[def.key] as { markdown?: unknown } | undefined
      if (typeof product?.markdown !== 'string' || product.markdown.trim() === '') {
        throw new Error('正文复检拒绝：产物缺少 markdown 字段')
      }
      await recheckSectionDraft(task, product.markdown)
    }
  }
  return output
}

/** 本节已落库的回放课件 code（正文 :::replay 按 code 定位，arch/06 §2.2）。 */
async function replayCodesOf(task: ProductionTaskRow): Promise<string[]> {
  const rows = await widgetsRepo.listWidgets(task.course_id, task.section_id)
  return rows.filter((row) => row.type === 'bar-replay-decision' && row.code).map((row) => row.code!)
}

/** 正文三层校验的后两层：解析 → 语义校验 → 全过才整体落列（绝不部分落库）。 */
async function recheckSectionDraft(task: ProductionTaskRow, markdown: string): Promise<void> {
  let ast: ReturnType<typeof parseDsl>
  try {
    ast = parseDsl(markdown)
  } catch (err) {
    throw new Error(`正文语法错误：${(err as Error).message}`)
  }
  const [figureRows, unitRows, stocks, terms] = await Promise.all([
    textbookRepo.listFigures(task.course_id, task.section_id),
    listSourceUnitsByCourse(task.course_id),
    quotesRepo.listCaseStocks(task.course_id, task.section_id),
    conceptTerms(task.course_id),
  ])
  // v2 溯源块依赖（arch/06 §2.4）：案例窗口、真实交易日、本节回放课件。
  const caseWindows = new Map(stocks.map((stock) => [stock.code, { from: stock.window_start, to: stock.window_end }]))
  const tradingDays = new Map<string, Set<string>>()
  for (const stock of stocks) {
    const days = await quotesRepo.tradingDays(stock.code, stock.window_start, stock.window_end)
    tradingDays.set(stock.code, new Set(days))
  }
  const replayRows = await widgetsRepo.listWidgets(task.course_id, task.section_id)
  const replayCodes = new Map<string, number>()
  for (const row of replayRows) {
    if (row.type !== 'bar-replay-decision' || !row.code) continue
    replayCodes.set(row.code, (replayCodes.get(row.code) ?? 0) + 1)
  }
  const issues = validateDsl(ast, {
    figureIds: new Set(figureRows.map((row) => row.id)),
    units: new Map(
      unitRows.map((row) => [
        row.id,
        { assetId: row.asset_id, startMs: row.start_ms, endMs: row.end_ms },
      ]),
    ),
    stockCodes: new Set(stocks.map((stock) => stock.code)),
    terms,
    caseWindows,
    tradingDays,
    replayCodes,
  })
  if (issues.length > 0) {
    throw new Error(formatIssues('正文复检拒绝', issues))
  }
  await textbookRepo.saveSectionBody({
    courseId: task.course_id,
    sectionId: task.section_id,
    dslVersion: ast.version,
    body: markdown,
  })
}

/** 步失败分级（arch/05 §7）：预算触线直接挂起；其余回灌，超上限挂起。 */
export async function handleStepError(task: ProductionTaskRow, err: unknown): Promise<'pending' | 'pending_manual'> {
  const message =
    err instanceof LlmError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err)
  if (err instanceof LlmError && err.code === 'budget_exhausted') {
    await suspendTask(task.id, message)
    await recordStepEvent(task, 'pending_manual', `第 ${stepDef(task.step).n} 步「${stepDef(task.step).label}」挂起待人工`, message)
    return 'pending_manual'
  }
  const outcome = await failStep(task, message)
  const def = stepDef(task.step)
  await recordStepEvent(
    task,
    outcome === 'pending_manual' ? 'pending_manual' : 'failed',
    outcome === 'pending_manual'
      ? `第 ${def.n} 步「${def.label}」回灌超上限，挂起待人工`
      : `第 ${def.n} 步「${def.label}」失败，回灌重写`,
    message,
  )
  return outcome
}

/** 步状态事件（running / done / failed / pending_manual）：只记事实与原因。 */
async function recordStepEvent(
  task: ProductionTaskRow,
  status: 'running' | 'done' | 'failed' | 'pending_manual',
  title: string,
  detail?: string | null,
): Promise<void> {
  const def = stepDef(task.step)
  await recordEvent({
    courseId: task.course_id,
    sectionId: task.section_id,
    kind: 'step',
    step: task.step,
    title,
    detail: detail ?? null,
    payload: { status, stepKey: def.key, stepLabel: def.label },
  })
}

/**
 * 模型调用记成工具卡：只记事实（模型、耗时、token），不记模型措辞。
 *
 * ai_runs 里没有 prompt/response 列——措辞无从取，也不该由我们复述。
 * 同一次调用只记一张卡（runId 去重：重跑同一步时旧的卡不重复记）。
 */
async function recordToolEvents(task: ProductionTaskRow, def: StepDef): Promise<void> {
  if (def.kind !== 'agent') return
  const runs = await listTaskRuns([task.id])
  if (runs.length === 0) return
  const recorded = new Set(await listRecordedRunIds(task.course_id, runs.map((run) => run.id)))
  for (const run of runs) {
    if (recorded.has(run.id)) continue
    await recordEvent({
      courseId: task.course_id,
      sectionId: task.section_id,
      kind: 'tool',
      step: task.step,
      title: `第 ${def.n} 步「${def.label}」调用模型 ${run.model}`,
      detail: run.summary,
      payload: {
        runId: run.id,
        model: run.model,
        status: run.status,
        latencyMs: run.latency_ms,
        tokensIn: run.tokens_in,
        tokensOut: run.tokens_out,
        stepKey: def.key,
        stepLabel: def.label,
      },
    })
  }
}

// ---------------------------------------------------------------- pure 步（确定性，不走模型）

async function runPureStep(key: string, task: ProductionTaskRow): Promise<Record<string, unknown>> {
  switch (key) {
    case 'market_sync':
      // 逐股同步（源不可用 → 该股 unavailable，不抛错不挂起——发布可继续）。
      return await syncQuotesForSection(task.course_id, task.section_id)
    case 'market_readback':
      // 直接读 quote_bars 缓存核对（bars 是权威缓存，步骤 2 重跑也一致）。
      return await readbackQuotes(task.course_id, task.section_id)
    case 'provenance':
      return {
        aiRuns: await countSectionRuns(task.course_id, task.section_id),
        steps: STEP_COUNT,
        recordedAt: new Date().toISOString(),
      }
    default:
      throw new Error(`未知 pure 步：${key}`)
  }
}
