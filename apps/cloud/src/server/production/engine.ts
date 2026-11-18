import 'server-only'
import { LlmError } from '@/server/content/agents/llm'
import { runStepAgent } from './agent'
import {
  completeStep,
  countSectionRuns,
  failStep,
  findTask,
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
 */

export async function executeStep(task: ProductionTaskRow, section: SectionRow): Promise<void> {
  const def = stepDef(task.step)
  let output: Record<string, unknown> | undefined
  if (def.kind === 'pure') {
    // pure 步产物按步骤键入 checkpoint（读回步按键取前置产物）。
    output = { [def.key]: await runPureStep(def.key, task) }
  } else {
    await runStepAgent({ task, section })
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
      // 占位：真实行情同步接行情域后替换（迭代 6）。
      return { syncedAt: new Date().toISOString(), quotes: {} }
    case 'market_readback': {
      const prev = await findTask(task.course_id, task.section_id, 2)
      const quotes = await stepOutput(prev, 'market_sync')
      const synced = (quotes as { quotes?: Record<string, unknown> } | null)?.quotes ?? {}
      return { rows: Object.keys(synced).length, readbackAt: new Date().toISOString() }
    }
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

/** 读前置步写入 checkpoint 的产物（读回步依赖同节更早步，顺序强制保证存在）。 */
async function stepOutput(
  task: ProductionTaskRow | null,
  key: string,
): Promise<unknown> {
  if (!task) throw new Error(`前置步任务不存在：${key}`)
  const checkpoint = await getTaskCheckpoint(task.id)
  if (!checkpoint || !(key in checkpoint)) {
    throw new Error(`前置步产物缺失：${key}`)
  }
  return checkpoint[key]
}
