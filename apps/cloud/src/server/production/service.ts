import 'server-only'
import {
  productionBoardView,
  type ProductionBoardView,
  type SectionQuotesView,
  type SessionUser,
} from '@trend-suite/contracts'
import { forbidden, HttpError, notFound } from '@/server/lib/http'
import { getCourseForUser } from '@/server/content/service'
import { sectionQuotes } from '@/server/content/quotes/service'
import { enqueueJob, findJobByCourse } from '@/server/pipeline/jobs/repo'
import * as repo from './repo'
import { PRODUCTION_RUN_JOB_KIND, STEP_DEFS } from './steps'

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
