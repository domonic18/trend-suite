import 'server-only'
import { LlmError } from '@/server/content/agents/llm'
import { persistCaseStocks, readbackQuotes, syncQuotesForSection } from '@/server/content/quotes/service'
import { runStepAgent } from './agent'
import {
  completeStep,
  countSectionRuns,
  failStep,
  getTaskCheckpoint,
  suspendTask,
  type ProductionTaskRow,
  type SectionRow,
} from './repo'
import { stepDef, STEP_COUNT } from './steps'

/**
 * 步执行状态机（arch/05 §6/§7）：按 STEP_DEFS 分发 agent/pure，
 * 产物过第一层校验后 completeStep 幂等落库；失败走回灌或挂起。
 * 顺序强制是结构性的：claimNextStep 只认领「更小步全 done」的 pending 行。
 * 行情同步/读回是 pure 步且源不可用走占位降级（步骤照常 done）——挂起只留给 agent 步。
 */

export async function executeStep(task: ProductionTaskRow, section: SectionRow): Promise<void> {
  const def = stepDef(task.step)
  let output: Record<string, unknown> | undefined
  if (def.kind === 'pure') {
    // pure 步产物按步骤键入 checkpoint（读回步按键取前置产物）。
    output = { [def.key]: await runPureStep(def.key, task) }
  } else {
    await runStepAgent({ task, section })
    if (def.key === 'case_stocks') {
      // 云端复检 + 落库（arch/06 §5.1）：结构性违例抛错走回灌，与源不可用区分。
      const checkpoint = await getTaskCheckpoint(task.id)
      await persistCaseStocks(task.course_id, task.section_id, checkpoint?.[def.key])
    }
  }
  await completeStep(task, output)
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
    return 'pending_manual'
  }
  return failStep(task, message)
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
