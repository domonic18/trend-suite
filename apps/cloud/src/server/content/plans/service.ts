import 'server-only'
import {
  type AgentTraceView,
  type CourseOutlineView,
  type PlanCoverageView,
  type PlanJobView,
  type PlanMaterialView,
  type PlanView,
  type SessionUser,
  type SubmitPlanInputRequest,
  conceptEdgeRecordView,
  conceptView,
  conceptsResponse,
  planJobView,
  planView,
  rejectPlanRequest,
  renderOutlineText,
  submitPlanInputRequest,
  tweakPlanRequest,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { withTransaction } from '@/server/lib/db'
import { badRequest, forbidden, HttpError } from '@/server/lib/http'
import { getCourseForUser } from '../service'
import { listAssetsByCourse } from '@/server/pipeline/repo'
import { listSourceUnitPointsByCourse, listUnitCountsByCourse } from '@/server/pipeline/processing/repo'
import { enqueueJob, findJobByCourse } from '@/server/pipeline/jobs/repo'
import { PRODUCTION_RUN_JOB_KIND } from '@/server/production/steps'
import { seedProduction } from '@/server/production/repo'
import { parseOutline, parseStoredOutline } from './outline'
import { buildAgentTrace } from './trace'
import { applyTweak, type PlanLesson, type TweakedContent } from './tweak'
import * as repo from './repo'

/**
 * 方案状态机（arch/05 §5 阶段三）：起草（队列）→ 批准（锁定基准版）
 * / 打回（意见重起草）/ 微调（结构化即时生效）。
 * 写动作给课程所属教师；admin 兼具 producer 做课权限（arch/01 角色口径）。
 */

export const CURRICULUM_JOB_KIND = 'curriculum_draft'

export type PlanActor = SessionUser

/** 九步粒度 = 目录叶子节点（无子节点的节点即一节；篇/卷整卷无分节时它自己就是节）。 */
function leafSectionNodes(nodes: { id: string; title: string; parentId: string | null }[]): {
  id: string
  title: string
  parentId: string | null
}[] {
  const parents = new Set(
    nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])),
  )
  return nodes.filter((node) => !parents.has(node.id))
}

/** producer 限本人课程；admin 兼具 producer 权限，不限归属；operator 只读。 */
async function requireOwnedCourse(actor: PlanActor, courseId: string) {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'admin' && (actor.role !== 'producer' || course.ownerId !== actor.id)) {
    throw forbidden('只有课程所属教师可以执行该操作')
  }
  return course
}

function toPlanJobView(row: {
  id: string
  course_id: string | null
  status: string
  attempts: number
  error_code: string | null
  error_message: string | null
  updated_at: Date
}): PlanJobView {
  return planJobView.parse({
    id: row.id,
    courseId: row.course_id,
    status: row.status,
    attempts: row.attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    updatedAt: row.updated_at.toISOString(),
  })
}

/**
 * 素材覆盖率：目录覆盖了素材里多少条教学要点。
 * 没有理解结果的素材没有要点可比——返回 null，不编 0%。
 */
async function planCoverageOf(
  courseId: string,
  lessons: PlanLesson[],
): Promise<PlanCoverageView | null> {
  const units = await listSourceUnitPointsByCourse(courseId)
  if (units.length === 0) return null
  const pointsById = new Map(units.map((unit) => [unit.id, unit.points.length]))
  const totalPoints = units.reduce((sum, unit) => sum + unit.points.length, 0)
  const bound = new Set(lessons.flatMap((lesson) => lesson.sourceUnitIds))
  const coveredPoints = [...bound].reduce((sum, id) => sum + (pointsById.get(id) ?? 0), 0)
  if (totalPoints === 0) return null
  return { coveredPoints, totalPoints, ratio: coveredPoints / totalPoints }
}

async function toPlanView(row: repo.CoursePlanRow): Promise<PlanView> {
  const lessons = (row.section_plan as TweakedContent['sectionPlan']).lessons ?? []
  const coverage = await planCoverageOf(row.course_id, lessons)
  return planView.parse({
    id: row.id,
    courseId: row.course_id,
    version: row.version,
    status: row.status,
    origin: row.origin,
    skeleton: row.skeleton,
    conceptMap: row.concept_map,
    glossary: row.glossary,
    sectionPlan: row.section_plan,
    violations: row.violations,
    coverage,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  })
}

function outlineOf(raw: unknown): CourseOutlineView {
  const parsed = parseStoredOutline(raw)
  if (!parsed) throw new HttpError(500, 'internal_error', '课程目录数据损坏')
  return parsed
}

function contentOf(row: repo.CoursePlanRow): TweakedContent {
  return {
    skeleton: row.skeleton as TweakedContent['skeleton'],
    conceptMap: row.concept_map as TweakedContent['conceptMap'],
    glossary: row.glossary as TweakedContent['glossary'],
    sectionPlan: row.section_plan as TweakedContent['sectionPlan'],
    violations: (row.violations ?? []) as TweakedContent['violations'],
  }
}

// ---------------------------------------------------------------- 提交目标与目录（触发起草）

export async function savePlanInput(
  actor: PlanActor,
  courseId: string,
  input: SubmitPlanInputRequest,
): Promise<PlanJobView> {
  await requireOwnedCourse(actor, courseId)
  const body = submitPlanInputRequest.parse(input)
  // 目录先验可留空（原型口径）：留空则由 Agent 依据目标与素材代拟一版并回写。
  const outlineText = body.outlineText.trim()
  const outline = outlineText.length > 0 ? parseOutline(outlineText) : null

  // 就绪度门禁（T7）：素材未全部就绪不可触发起草（partial 本迭代不开放）。
  const assets = await listAssetsByCourse(courseId)
  const readyCount = assets.filter((asset) => asset.status === 'ready').length
  if (assets.length === 0) {
    throw new HttpError(409, 'plan_not_draftable', '请先上传并加工课程素材')
  }
  if (!body.allowPartial && readyCount < assets.length) {
    throw new HttpError(409, 'plan_not_draftable', '素材尚未全部就绪，无法起草方案')
  }

  // 已有草案时重新提交 = 修订提纲重起草：旧草案转 superseded。
  const draft = await repo.findDraftPlan(courseId)
  if (draft) await repo.updatePlanStatus(draft.id, 'superseded')

  await repo.updateCoursePlanInput(courseId, {
    goal: body.goal,
    outlineText,
    outline,
  })
  // 规划模式与参与素材单独存：智能规划要重排目录，但不必改教师原文。
  await repo.updatePlanSelection(courseId, {
    planMode: body.mode ?? 'follow_manual',
    planAssetIds: body.assetIds && body.assetIds.length > 0 ? body.assetIds : null,
  })

  return toPlanJobView(await enqueueJob({ courseId, kind: CURRICULUM_JOB_KIND }))
}

// ---------------------------------------------------------------- 当前方案（轮询）

export async function getPlanFor(
  actor: PlanActor,
  courseId: string,
): Promise<{
  plan: PlanView | null
  job: PlanJobView | null
  input: { goal: string; outlineText: string } | null
  trace: AgentTraceView | null
  materials: PlanMaterialView[]
}> {
  await getCourseForUser(actor, courseId)
  const [draft, approved, job, input, assets, unitCounts] = await Promise.all([
    repo.findDraftPlan(courseId),
    repo.findApprovedPlan(courseId),
    findJobByCourse({ courseId, kind: CURRICULUM_JOB_KIND }),
    repo.findCoursePlanInput(courseId),
    listAssetsByCourse(courseId),
    listUnitCountsByCourse(courseId),
  ])
  const active = draft ?? approved
  // 目标必回填（教师可能只交了目标）；目录可能是空的（待 Agent 代拟）。
  const inputMeta = input?.goal ? { goal: input.goal, outlineText: input.outline_text ?? '' } : null
  const trace = await buildAgentTrace({
    courseId,
    plan: active,
    job: job
      ? {
          status: job.status,
          attempts: job.attempts,
          step: job.step,
          errorMessage: job.error_message,
        }
      : null,
    input: {
      goal: input?.goal ?? null,
      outlineText: input?.outline_text ?? null,
      submittedAt: input?.updated_at ?? null,
    },
  })
  const countsByAsset = new Map(unitCounts.map((row) => [row.asset_id, row]))
  const materials: PlanMaterialView[] = assets.map((asset) => {
    const counts = countsByAsset.get(asset.id)
    return {
      id: asset.id,
      fileName: asset.original_name ?? '素材',
      durationS: asset.duration_s === null ? null : Number(asset.duration_s),
      unitCount: counts?.unit_count ?? 0,
      pointCount: counts?.point_count ?? 0,
    }
  })
  return {
    plan: active ? await toPlanView(active) : null,
    job: job ? toPlanJobView(job) : null,
    input: inputMeta,
    trace,
    materials,
  }
}

// ---------------------------------------------------------------- 批准（锁定基准版）

export async function approvePlan(actor: PlanActor, courseId: string): Promise<PlanView> {
  await requireOwnedCourse(actor, courseId)
  const draft = await repo.findDraftPlan(courseId)
  if (!draft) throw badRequest('没有待批准的方案草案')

  const content = contentOf(draft)
  const lowMatch = content.skeleton.nodes.filter((node) => node.matchStatus === 'low_match')
  if (lowMatch.length > 0 || content.violations.length > 0) {
    throw new HttpError(
      409,
      'plan_unresolved',
      lowMatch.length > 0
        ? `存在 ${lowMatch.length} 个证据不足的分节，请先裁决（修订提纲或补充素材）`
        : '存在未处理的拒绝记录，请修订提纲后重新起草',
    )
  }

  const conceptMap = content.conceptMap
  // 九步生产播种：目录叶子节点 = 节（arch/05 §6 粒度），批准事务内幂等预插。
  const leafNodes = leafSectionNodes(content.skeleton.nodes)
  await withTransaction(async (tx) => {
    // 概念落库沿用草案 id（cpt_），保证后续微调 add_alias 能同步更新。
    await repo.insertConcepts(
      conceptMap.concepts.map((concept) => ({
        id: concept.id,
        courseId,
        name: concept.name,
        aliases: concept.aliases,
        definition: concept.definition,
      })),
      tx,
    )
    await repo.insertConceptEdges(
      conceptMap.edges.map((edge) => ({
        id: newId('concept'),
        courseId,
        fromConcept: edge.fromId,
        toConcept: edge.toId,
        kind: edge.kind,
      })),
      tx,
    )
    await repo.updatePlanStatus(draft.id, 'approved', tx)
    await seedProduction(
      courseId,
      leafNodes.map((node, index) => ({
        sectionId: node.id,
        title: node.title,
        order: index,
      })),
      tx,
    )
  })
  await enqueueJob({ courseId, kind: PRODUCTION_RUN_JOB_KIND })
  const approved = await repo.findPlanById(draft.id)
  return await toPlanView(approved!)
}

// ---------------------------------------------------------------- 打回（意见重起草）

export async function rejectPlan(
  actor: PlanActor,
  courseId: string,
  input: unknown,
): Promise<PlanView> {
  await requireOwnedCourse(actor, courseId)
  const body = rejectPlanRequest.parse(input)
  const draft = await repo.findDraftPlan(courseId)
  if (!draft) throw badRequest('没有可打回的草案')

  // 不重跑素材理解：占位行携带上一版内容与教师意见，worker 只重新综合。
  const version = await repo.nextPlanVersion(courseId)
  const created = await withTransaction(async (tx) => {
    await repo.updatePlanStatus(draft.id, 'rejected', tx)
    return repo.insertPlan(
      {
        id: newId('plan'),
        courseId,
        version,
        status: 'draft',
        origin: 'revision',
        parentPlanId: draft.id,
        triggerNote: body.feedback,
        createdBy: actor.id,
        ...contentOf(draft),
      },
      tx,
    )
  })
  await enqueueJob({ courseId, kind: CURRICULUM_JOB_KIND })
  return await toPlanView(created)
}

// ---------------------------------------------------------------- 微调（结构化，即时生效）

export async function tweakPlan(
  actor: PlanActor,
  courseId: string,
  input: unknown,
): Promise<PlanView> {
  await requireOwnedCourse(actor, courseId)
  const op = tweakPlanRequest.parse(input)
  const active = (await repo.findDraftPlan(courseId)) ?? (await repo.findApprovedPlan(courseId))
  if (!active) throw badRequest('暂无可微调的方案')

  const inputRow = await repo.findCoursePlanInput(courseId)
  if (!inputRow?.outline) throw badRequest('课程目录缺失，请先提交课程目标与目录')
  const outline = outlineOf(inputRow.outline)
  const tweaked = applyTweak(contentOf(active), op, outline)

  const version = await repo.nextPlanVersion(courseId)
  const wasApproved = active.status === 'approved'
  const created = await withTransaction(async (tx) => {
    await repo.updatePlanStatus(active.id, 'superseded', tx)
    const row = await repo.insertPlan(
      {
        id: newId('plan'),
        courseId,
        version,
        status: wasApproved ? 'approved' : 'draft',
        origin: 'tweak',
        parentPlanId: active.id,
        triggerNote: JSON.stringify(op),
        createdBy: actor.id,
        ...tweaked.content,
      },
      tx,
    )
    // 已批准方案的别名微调要同步概念表（术语校验基准随之更新）。
    if (wasApproved && op.op === 'add_alias') {
      const concept = tweaked.content.conceptMap.concepts.find((entry) => entry.id === op.conceptId)
      if (concept) {
        await repo.updateConceptAliases(courseId, op.conceptId, concept.aliases)
      }
    }
    return row
  })
  await repo.updateCourseOutline(courseId, tweaked.outline)
  // 目录文本与树同源：微调后同步回写文本，否则重起草会读到微调前的旧文本。
  await repo.updateCourseOutlineText(
    courseId,
    renderOutlineText(
      tweaked.outline.nodes.map((node) => ({ level: node.level as 1 | 2 | 3, title: node.title })),
    ),
  )
  return await toPlanView(created)
}

// ---------------------------------------------------------------- 概念（批准后只读）

export async function listConceptsFor(actor: PlanActor, courseId: string) {
  await getCourseForUser(actor, courseId)
  const [items, edges] = await Promise.all([
    repo.listConceptRows(courseId),
    repo.listConceptEdgeRows(courseId),
  ])
  return conceptsResponse.parse({
    items: items.map((row) =>
      conceptView.parse({
        id: row.id,
        courseId: row.course_id,
        name: row.name,
        aliases: row.aliases,
        definition: row.definition,
        createdAt: row.created_at.toISOString(),
      }),
    ),
    edges: edges.map((row) =>
      conceptEdgeRecordView.parse({
        id: row.id,
        fromConceptId: row.from_concept,
        toConceptId: row.to_concept,
        kind: row.kind,
      }),
    ),
  })
}
