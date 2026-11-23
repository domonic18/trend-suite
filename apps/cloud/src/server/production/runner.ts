import 'server-only'
import { executeStep, handleStepError } from './engine'
import { recordProgressEvent } from '@/server/agent-chat/progress'
import {
  claimNextStep,
  completeSectionIfAllDone,
  findSection,
  listSections,
  resetRunningTasks,
  type SectionRow,
} from './repo'
import { MAX_SECTIONS_PARALLEL } from './limits'
import { PRODUCTION_RUN_JOB_KIND } from './steps'
import * as jobs from '@/server/pipeline/jobs/repo'
import type { PipelineJobRow } from '@/server/pipeline/jobs/repo'

/**
 * production_run job 执行器（arch/05 §6）：崩溃先重置孤儿 running 行，
 * 节间并行（上限 MAX_SECTIONS_PARALLEL）互不阻塞；一节挂起不影响他节。
 * done 步天然跳过（claimNextStep 只认领 pending）——重投即断点续跑。
 */

export { PRODUCTION_RUN_JOB_KIND }

export async function runProductionRun(job: PipelineJobRow): Promise<void> {
  const courseId = job.course_id
  if (!courseId) {
    await jobs.failJob({
      jobId: job.id,
      code: 'course_not_found',
      message: 'production_run 任务缺少 course_id',
      retryable: false,
    })
    return
  }

  const reset = await resetRunningTasks(courseId)
  if (reset > 0) console.log(`[production] 课程 ${courseId} 重置孤儿 running 步 ${reset} 个`)

  const sections = await listSections(courseId)
  const pending = sections.filter((section) => section.status === 'pending')
  if (pending.length === 0) {
    await jobs.completeJob(job.id)
    return
  }
  // 本轮起点入对话流：教师在制作台一眼看到「这轮要产几节」。
  await recordProgressEvent(courseId, 'production', {
    kind: 'production_started',
    detail: `本轮制作开始：${pending.length} 节待产，九步逐节推进。`,
    level: 'info',
  })
  const outcomes = await mapPool(pending, MAX_SECTIONS_PARALLEL, (section) =>
    runProductionSection(job.id, courseId, section),
  )

  const completed = outcomes.filter((o) => o === 'completed').length
  const suspended = outcomes.filter((o) => o === 'suspended').length
  const stopped = outcomes.filter((o) => o === 'stopped').length
  // 停止是教师主动动作：job 记 canceled（不是失败），成果与回灌预算保留，可继续。
  // 只要有节被停下，整轮就不是「成功」——已跑完的节仍留在库里。
  if (stopped > 0) {
    await jobs.cancelJob(job.id)
    return
  }
  if (pending.length > 0 && completed === 0 && suspended === pending.length) {
    await jobs.failJob({
      jobId: job.id,
      code: 'production_suspended',
      message: `全部 ${suspended} 节挂起（失败或预算触线），请在看板重试`,
      retryable: false,
    })
    await recordProgressEvent(courseId, 'production', {
      kind: 'production_failed',
      detail: `本轮制作全部挂起：${suspended} 节失败或预算触线，重试后可续跑。`,
      level: 'err',
    })
    return
  }
  await jobs.completeJob(job.id)
  await recordProgressEvent(courseId, 'production', {
    kind: 'production_completed',
    detail: `本轮制作收尾：${completed}/${pending.length} 节完成${suspended > 0 ? `，${suspended} 节挂起待人工` : ''}。`,
    level: suspended > 0 ? 'info' : 'ok',
  })
}

/**
 * 单节逐步跑（arch/05 §6）。
 *
 * 停止是**步边界**安全中止：当前步跑完才停（步内产物不丢），已完成的步成果保留，
 * 回灌预算（attempts）不清零——教师改完内容继续时，重跑的不是已完成的步。
 */
async function runProductionSection(
  jobId: string,
  courseId: string,
  section: SectionRow,
): Promise<'completed' | 'suspended' | 'stopped'> {
  for (;;) {
    if (await jobs.isCancelRequested(jobId)) return 'stopped'
    const task = await claimNextStep(courseId, section.section_id)
    if (!task) break
    try {
      await executeStep(task, section)
    } catch (err) {
      const outcome = await handleStepError(task, err, section.title)
      if (outcome === 'pending_manual') return 'suspended'
    }
  }
  // 九步全 done 即翻 complete（幂等）：覆盖重同步/重试后的复原，以及
  // 第 9 步与节翻转之间崩溃的窗口（completeStep 的两段写非同一事务）。
  await completeSectionIfAllDone(courseId, section.section_id)
  const final = await findSection(courseId, section.section_id)
  return final?.status === 'complete' ? 'completed' : 'suspended'
}

/** 节间并行：固定 worker 池，单节异常冒泡由 job 层整体重试。 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) return
      results[index] = await fn(item)
    }
  })
  await Promise.all(workers)
  return results
}
