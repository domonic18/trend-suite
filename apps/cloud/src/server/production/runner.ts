import 'server-only'
import { executeStep, handleStepError } from './engine'
import {
  claimNextStep,
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
  const outcomes = await mapPool(pending, MAX_SECTIONS_PARALLEL, (section) =>
    runProductionSection(courseId, section),
  )

  const completed = outcomes.filter((o) => o === 'completed').length
  const suspended = outcomes.filter((o) => o === 'suspended').length
  if (pending.length > 0 && completed === 0 && suspended === pending.length) {
    await jobs.failJob({
      jobId: job.id,
      code: 'production_suspended',
      message: `全部 ${suspended} 节挂起（失败或预算触线），请在看板重试`,
      retryable: false,
    })
    return
  }
  await jobs.completeJob(job.id)
}

async function runProductionSection(courseId: string, section: SectionRow): Promise<'completed' | 'suspended'> {
  for (;;) {
    const task = await claimNextStep(courseId, section.section_id)
    if (!task) break
    try {
      await executeStep(task, section)
    } catch (err) {
      const outcome = await handleStepError(task, err)
      if (outcome === 'pending_manual') return 'suspended'
    }
  }
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
