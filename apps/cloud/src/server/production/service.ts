import 'server-only'
import {
  productionBoardView,
  productionStopView,
  type ProductionBoardView,
  type ProductionStopView,
  type SectionQuotesView,
  type SessionUser,
} from '@trend-suite/contracts'
import { forbidden, HttpError, notFound } from '@/server/lib/http'
import { getCourseForUser } from '@/server/content/service'
import { sectionQuotes } from '@/server/content/quotes/service'
import {
  cancelJob,
  enqueueJob,
  findJobByCourse,
  requestCancel,
  revokeCancel,
  type PipelineJobRow,
} from '@/server/pipeline/jobs/repo'
import { ensureCourseThread, lastProgressEvent, recordProgressEvent } from '@/server/agent-chat/progress'
import { insertMessage } from '@/server/agent-chat/repo'
import * as repo from './repo'
import { PRODUCTION_RUN_JOB_KIND, STEP_DEFS, stepDef } from './steps'

/**
 * 九步看板与挂起重试（arch/05 §6）：看板对 producer 本人可读写，
 * admin 兼具 producer 权限（arch/01 角色口径），operator 只读；写动作只动本节待办。
 * 停止/继续在对话里由 Agent 调用 internal 变体执行（教师意图驱动），
 * 权限已在 sendMessage/answer 时校验；HTTP 端点只剩看板/重试/行情/内容。
 */

export async function getProductionBoard(
  actor: SessionUser,
  courseId: string,
): Promise<ProductionBoardView> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role === 'producer' && course.ownerId !== actor.id) {
    throw forbidden('只有课程所属教师可以查看该看板')
  }
  return getProductionBoardInternal(courseId)
}

/** 看板读取（线程工具复用）：在线程授权语境下调用，不再重复权限校验。 */
export async function getProductionBoardInternal(courseId: string): Promise<ProductionBoardView> {
  const [sections, tasks, job] = await Promise.all([
    repo.listSections(courseId),
    repo.listTasks(courseId),
    findJobByCourse({ courseId, kind: PRODUCTION_RUN_JOB_KIND }),
  ])
  const tasksBySection = new Map<string, Map<number, repo.ProductionTaskRow>>()
  for (const task of tasks) {
    let byStep = tasksBySection.get(task.section_id)
    if (!byStep) {
      byStep = new Map()
      tasksBySection.set(task.section_id, byStep)
    }
    byStep.set(task.step, task)
  }
  const stopState = await stopStateOf(courseId, job)
  const board: ProductionBoardView = {
    courseId,
    sections: sections.map((section) => {
      const byStep = tasksBySection.get(section.section_id) ?? new Map()
      const taskViews = STEP_DEFS.flatMap((def) => {
        const task = byStep.get(def.n)
        if (!task) return []
        return [
          {
            step: def.n,
            key: def.key,
            label: def.label,
            status: task.status,
            attempts: task.attempts,
            lastError: task.last_error,
            updatedAt: task.updated_at.toISOString(),
          },
        ]
      })
      return {
        sectionId: section.section_id,
        title: section.title,
        order: section.sort_order,
        status: section.status,
        products: taskViews.filter((t) => t.status === 'done').length,
        bodyStatus: section.body_status,
        tasks: taskViews,
      }
    }),
    job: job
      ? {
          id: job.id,
          courseId: job.course_id ?? courseId,
          status: job.status,
          attempts: job.attempts,
          errorCode: job.error_code,
          errorMessage: job.error_message,
          updatedAt: job.updated_at.toISOString(),
        }
      : null,
    stop: stopState.stop,
  }
  return productionBoardView.parse(board)
}

export async function retryProductionSection(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<{ ok: true }> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以重试该节')
  }
  await retryProductionSectionInternal(courseId, sectionId)
  return { ok: true }
}

/** 节重试（线程工具复用）：重置挂起/失败步并重投 job，无可重试步抛 409。 */
export async function retryProductionSectionInternal(
  courseId: string,
  sectionId: string,
): Promise<void> {
  const section = await repo.findSection(courseId, sectionId)
  if (!section) throw notFound('节不存在')
  const reset = await repo.retrySection(courseId, sectionId)
  if (reset === 0) {
    throw new HttpError(409, 'production_not_retryable', '该节没有可重试的挂起/失败步')
  }
  await enqueueJob({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  await recordProgressEvent(courseId, 'production', {
    kind: 'section_retried',
    detail: `「${section.title}」已重置挂起/失败步并重新排队制作。`,
    level: 'info',
    extra: { sectionId },
  })
}

/** 节行情视图（看板「产物」面板）：读权限同看板（producer 本人 / operator / admin）。 */
export async function getSectionQuotes(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<SectionQuotesView> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role === 'producer' && course.ownerId !== actor.id) {
    throw forbidden('只有课程所属教师可以查看该节行情')
  }
  const section = await repo.findSection(courseId, sectionId)
  if (!section) throw notFound('节不存在')
  return sectionQuotes(courseId, sectionId)
}

/**
 * 重新同步行情：只重置步骤 2/3 再重投 job——案例股（步骤 1，LLM 付费步）不重跑。
 * 运行中互斥（409）；无可重置的行情步也 409。
 */
export async function resyncProductionQuotes(
  actor: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<{ ok: true }> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以重新同步该节行情')
  }
  const section = await repo.findSection(courseId, sectionId)
  if (!section) throw notFound('节不存在')
  const running = await repo.countRunningTasks(courseId, sectionId)
  if (running > 0) {
    throw new HttpError(409, 'production_not_retryable', '该节正在运行，等本轮结束再重新同步行情')
  }
  const reset = await repo.resyncQuoteSteps(courseId, sectionId)
  if (reset === 0) {
    throw new HttpError(409, 'production_not_retryable', '行情步尚未产出，无可重新同步的内容')
  }
  await enqueueJob({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  return { ok: true }
}

// ---------------------------------------------------------------- 停止 / 继续（教师端需求 T21，对话动作）

/**
 * 停止制作（教师端需求 T21）：**步边界**安全中止。
 *
 * 当前步跑完才停——步内产物不丢；已完成的步成果保留；回灌预算（attempts）不清零，
 * 教师改完内容继续时，重跑的是没做完的步，不重跑已完成的步。
 */
export async function stopProductionInternal(courseId: string): Promise<ProductionStopView> {
  const job = await findJobByCourse({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  if (!job || (job.status !== 'running' && job.status !== 'queued')) {
    throw new HttpError(409, 'production_not_running', '当前没有在跑的制作任务，无需停止')
  }
  const point = await stopPointOf(courseId)
  if (job.status === 'queued') {
    // 还没开跑：直接取消 job，没有任何产物需要保留。
    await cancelJob(job.id)
  } else {
    // 在跑：置取消请求，runner 在步边界读到后安全中止。
    await requestCancel(job.id)
  }
  await recordProgressEvent(courseId, 'production', {
    kind: 'production_stopped',
    detail: point.step
      ? `已停止：${point.sectionTitle ?? ''}停在第 ${point.step} 步「${point.stepLabel ?? ''}」——已完成的步成果保留，改完可继续`
      : '已停止：尚未开跑，已停止',
    level: 'info',
    extra: {
      sectionId: point.sectionId,
      sectionTitle: point.sectionTitle,
      step: point.step,
      stepKey: point.stepKey,
      stepLabel: point.stepLabel,
    },
  })
  // 停止后确认卡接续（需求 T21）：三个选项里「继续/重做」绑定确定性动作，
  // 由答案处理器执行，不经模型——与方案批准同一红线。
  if (point.sectionId) {
    const thread = await ensureCourseThread(courseId, 'production')
    if (thread) {
      await insertMessage(thread.id, 'question', {
        question: {
          text: `已停在「${point.sectionTitle ?? ''}」第 ${point.step ?? '?'} 步「${point.stepLabel ?? ''}」。接下来怎么处理？`,
          options: [
            { label: '改完继续制作', description: '我先调整内容，之后从停下的步接着跑', action: 'resume_production' },
            { label: '先去调整内容', description: '暂不继续，稍后在对话里吩咐「继续制作」' },
            {
              label: '放弃本节重做',
              description: '重置该节失败/挂起的步，重新排队制作',
              action: 'retry_section',
              sectionId: point.sectionId,
            },
          ],
          answeredIndex: null,
        },
      })
    }
  }
  return productionStopView.parse({
    stopped: true,
    sectionId: point.sectionId,
    sectionTitle: point.sectionTitle,
    step: point.step,
    stepKey: point.stepKey,
    stepLabel: point.stepLabel,
    at: new Date().toISOString(),
  })
}

/**
 * 继续制作：接着停下的地方跑，已完成的步不重跑。
 *
 * 三种落点：
 * ① 没有活跃 job（已停完）→ 新入队一个 job（终态 job 不复活）。
 * ② job 在跑但**停止请求还没被 worker 读到**（正走在步边界）→ 撤销停止请求，
 *    同一个 job 继续跑。不新建 job：同一课的活跃 job 有唯一索引，
 *    新 worker 起来还会重置孤儿 running 步，可能与旧 worker 抢同一步。
 * ③ job 确实在跑 → 409（继续无意义）。
 */
export async function resumeProductionInternal(courseId: string): Promise<void> {
  const job = await findJobByCourse({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  if (job && job.status === 'running') {
    if (!job.cancel_requested) {
      throw new HttpError(409, 'production_already_running', '制作已经在跑了，无需继续')
    }
    await revokeCancel(job.id)
  } else if (job && job.status === 'queued') {
    throw new HttpError(409, 'production_already_running', '制作已经在跑了，无需继续')
  }
  await enqueueJob({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  await recordProgressEvent(courseId, 'production', {
    kind: 'production_resumed',
    detail: '继续制作：从停下的地方接着跑，已完成的步不重跑。',
    level: 'info',
  })
}

// ---------------------------------------------------------------- 停止点推导

type StopPoint = {
  sectionId: string | null
  sectionTitle: string | null
  step: number | null
  stepKey: string | null
  stepLabel: string | null
}

/** 当前正在跑的那一步（停在哪）：没有 running 步 = 还没开跑或已停在步边界。 */
async function stopPointOf(courseId: string): Promise<StopPoint> {
  const running = await repo.listRunningTasks(courseId)
  const task = running[0]
  if (!task) {
    return { sectionId: null, sectionTitle: null, step: null, stepKey: null, stepLabel: null }
  }
  const section = await repo.findSection(courseId, task.section_id)
  const def = stepDef(task.step)
  return {
    sectionId: task.section_id,
    sectionTitle: section?.title ?? null,
    step: task.step,
    stepKey: def.key,
    stepLabel: def.label,
  }
}

/**
 * 当前是否处于「已停止」状态。
 *
 * 口径：**没有在跑/排队的 job**，且线程里最后一条控制事件是「停止」→ 已停止（可继续）。
 * 取消请求已下达但 runner 还没走到步边界的这一小段时间里，也算「已停止」——
 * 否则按钮刚点完，界面又跳回「正在执行」，教师会以为没点上。
 */
async function stopStateOf(
  courseId: string,
  job: PipelineJobRow | null,
): Promise<{ stopped: boolean; stop: ProductionStopView | null }> {
  if (job && job.status === 'queued') return { stopped: false, stop: null }
  const event = await lastProgressEvent(courseId, 'production', [
    'production_stopped',
    'production_resumed',
  ])
  if (!event || event.kind !== 'production_stopped') return { stopped: false, stop: null }
  // 停止之后又起了新一轮（继续/重试/重新批准）：停止已过期。
  if (job && job.created_at.getTime() > event.createdAt.getTime()) {
    return { stopped: false, stop: null }
  }
  // job 仍在跑且没有取消请求：不是停止态。
  if (job && job.status === 'running' && !job.cancel_requested) {
    return { stopped: false, stop: null }
  }
  const payload = event.payload
  const stop = productionStopView.parse({
    stopped: true,
    sectionId: typeof payload.sectionId === 'string' ? payload.sectionId : null,
    sectionTitle: typeof payload.sectionTitle === 'string' ? payload.sectionTitle : null,
    step: typeof payload.step === 'number' ? payload.step : null,
    stepKey: typeof payload.stepKey === 'string' ? payload.stepKey : null,
    stepLabel: typeof payload.stepLabel === 'string' ? payload.stepLabel : null,
    at: event.createdAt.toISOString(),
  })
  return { stopped: true, stop }
}
