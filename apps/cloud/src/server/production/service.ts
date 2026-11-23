import 'server-only'
import {
  productionBoardView,
  productionEventView,
  productionStopView,
  productionStreamResponse,
  type ProductionBoardView,
  type ProductionEventView,
  type ProductionStopView,
  type ProductionStreamResponse,
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
import { findLastStopEvent, listEvents, recordEvent } from './events'
import * as repo from './repo'
import { PRODUCTION_RUN_JOB_KIND, STEP_DEFS, stepDef } from './steps'

/**
 * 九步看板与挂起重试（arch/05 §6）：看板对 producer 本人可读写，
 * admin 兼具 producer 权限（arch/01 角色口径），operator 只读；写动作只动本节待办。
 */

export async function getProductionBoard(
  actor: SessionUser,
  courseId: string,
): Promise<ProductionBoardView> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role === 'producer' && course.ownerId !== actor.id) {
    throw forbidden('只有课程所属教师可以查看该看板')
  }
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
  const section = await repo.findSection(courseId, sectionId)
  if (!section) throw notFound('节不存在')
  const reset = await repo.retrySection(courseId, sectionId)
  if (reset === 0) {
    throw new HttpError(409, 'production_not_retryable', '该节没有可重试的挂起/失败步')
  }
  await enqueueJob({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  return { ok: true }
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

// ---------------------------------------------------------------- 停止 / 继续（教师端需求 T21）

/**
 * 停止制作（教师端需求 T21）：**步边界**安全中止。
 *
 * 当前步跑完才停——步内产物不丢；已完成的步成果保留；回灌预算（attempts）不清零，
 * 教师改完内容继续时，重跑的是没做完的步，不重跑已完成的步。
 */
export async function stopProduction(
  actor: SessionUser,
  courseId: string,
): Promise<ProductionStopView> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以停止制作')
  }
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
  await recordEvent({
    courseId,
    sectionId: point.sectionId,
    kind: 'stop',
    step: point.step,
    title: '教师停止制作',
    detail: point.step
      ? `停在第 ${point.step} 步「${point.stepLabel ?? ''}」，已完成的步成果保留，改完可继续`
      : '尚未开跑，已停止',
    payload: {
      action: 'stop',
      sectionId: point.sectionId,
      sectionTitle: point.sectionTitle,
      step: point.step,
      stepKey: point.stepKey,
      stepLabel: point.stepLabel,
    },
  })
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
export async function resumeProduction(actor: SessionUser, courseId: string): Promise<{ ok: true }> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以继续制作')
  }
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
  await recordEvent({
    courseId,
    kind: 'stop',
    title: '教师继续制作',
    detail: '从停下的地方继续，已完成的步不重跑',
    payload: { action: 'resume' },
  })
  return { ok: true }
}

/**
 * Agent 事件流（增量）：教师端制作页的「Agent 正在做什么」。
 *
 * 游标 = 事件 seq（单调递增）；前端带上次游标续读，不全量拉。
 */
export async function getProductionStream(
  actor: SessionUser,
  courseId: string,
  afterSeq: string | null,
): Promise<ProductionStreamResponse> {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role === 'producer' && course.ownerId !== actor.id) {
    throw forbidden('只有课程所属教师可以查看该课程的制作过程')
  }
  const [rows, sections, job] = await Promise.all([
    listEvents(courseId, afterSeq),
    repo.listSections(courseId),
    findJobByCourse({ courseId, kind: PRODUCTION_RUN_JOB_KIND }),
  ])
  const titleBySection = new Map(sections.map((section) => [section.section_id, section.title]))
  const events: ProductionEventView[] = rows.map((row) => {
    const payload = row.payload ?? {}
    const step = row.step
    return productionEventView.parse({
      id: row.id,
      at: row.created_at.toISOString(),
      kind: row.kind,
      sectionId: row.section_id,
      sectionTitle: row.section_id ? (titleBySection.get(row.section_id) ?? null) : null,
      step,
      stepKey: typeof payload.stepKey === 'string' ? payload.stepKey : null,
      stepLabel: typeof payload.stepLabel === 'string' ? payload.stepLabel : null,
      title: row.title,
      detail: row.detail,
      status: typeof payload.status === 'string' ? payload.status : null,
      model: typeof payload.model === 'string' ? payload.model : null,
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : null,
      tokensIn: typeof payload.tokensIn === 'number' ? payload.tokensIn : null,
      tokensOut: typeof payload.tokensOut === 'number' ? payload.tokensOut : null,
    })
  })
  const stopState = await stopStateOf(courseId, job)
  return productionStreamResponse.parse({
    events,
    cursor: rows.length > 0 ? rows[rows.length - 1]!.seq : afterSeq,
    stopped: stopState.stopped,
    stop: stopState.stop,
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
 * 口径：**没有在跑/排队的 job**，且最后一条控制事件是「停止」→ 已停止（可继续）。
 * 取消请求已下达但 runner 还没走到步边界的这一小段时间里，也算「已停止」——
 * 否则按钮刚点完，界面又跳回「正在执行」，教师会以为没点上。
 */
async function stopStateOf(
  courseId: string,
  job: PipelineJobRow | null,
): Promise<{ stopped: boolean; stop: ProductionStopView | null }> {
  if (job && job.status === 'queued') return { stopped: false, stop: null }
  const event = await findLastStopEvent(courseId)
  if (!event) return { stopped: false, stop: null }
  const payload = event.payload ?? {}
  if (payload.action !== 'stop') return { stopped: false, stop: null }
  // 停止之后又起了新一轮（继续/重试/重新批准）：停止已过期。
  if (job && job.created_at.getTime() > event.created_at.getTime()) {
    return { stopped: false, stop: null }
  }
  // job 仍在跑且没有取消请求：不是停止态。
  if (job && job.status === 'running' && !job.cancel_requested) {
    return { stopped: false, stop: null }
  }
  const stop = productionStopView.parse({
    stopped: true,
    sectionId: typeof payload.sectionId === 'string' ? payload.sectionId : null,
    sectionTitle: typeof payload.sectionTitle === 'string' ? payload.sectionTitle : null,
    step: typeof payload.step === 'number' ? payload.step : null,
    stepKey: typeof payload.stepKey === 'string' ? payload.stepKey : null,
    stepLabel: typeof payload.stepLabel === 'string' ? payload.stepLabel : null,
    at: event.created_at.toISOString(),
  })
  return { stopped: true, stop }
}
