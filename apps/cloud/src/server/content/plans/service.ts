import 'server-only'
import {
  type CourseOutlineView,
  type PlanJobView,
  type PlanView,
  type SessionUser,
  type SubmitPlanInputRequest,
  conceptEdgeRecordView,
  conceptView,
  conceptsResponse,
  planJobView,
  planView,
  rejectPlanRequest,
  submitPlanInputRequest,
  tweakPlanRequest,
} from '@trend-suite/contracts'
import { newId } from '@/server/lib/ids'
import { withTransaction } from '@/server/lib/db'
import { badRequest, forbidden, HttpError } from '@/server/lib/http'
import { getCourseForUser } from '../service'
import { listAssetsByCourse } from '@/server/pipeline/repo'
import { enqueueJob, findJobByCourse } from '@/server/pipeline/jobs/repo'
import { PRODUCTION_RUN_JOB_KIND } from '@/server/production/steps'
import { seedProduction } from '@/server/production/repo'
import { parseOutline, parseStoredOutline } from './outline'
import { applyTweak, type TweakedContent } from './tweak'
import * as repo from './repo'

/**
 * 方案状态机（arch/05 §5 阶段三）：起草（队列）→ 批准（锁定基准版）
 * / 打回（意见重起草）/ 微调（结构化即时生效）。写动作只给课程所属教师。
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

async function requireOwnedCourse(actor: PlanActor, courseId: string) {
  const course = await getCourseForUser(actor, courseId)
  if (actor.role !== 'producer' || course.ownerId !== actor.id) {
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

function toPlanView(row: repo.CoursePlanRow): PlanView {
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

  return toPlanJobView(await enqueueJob({ courseId, kind: CURRICULUM_JOB_KIND }))
}

// ---------------------------------------------------------------- 当前方案（轮询）

export async function getPlanFor(
  actor: PlanActor,
  courseId: string,
): Promise<{ plan: PlanView | null; job: PlanJobView | null; input: { goal: string; outlineText: string } | null }> {
  await getCourseForUser(actor, courseId)
  const [draft, approved, job, input] = await Promise.all([
    repo.findDraftPlan(courseId),
    repo.findApprovedPlan(courseId),
    findJobByCourse({ courseId, kind: CURRICULUM_JOB_KIND }),
    repo.findCoursePlanInput(courseId),
  ])
  const active = draft ?? approved
  // 目标必回填（教师可能只交了目标）；目录可能是空的（待 Agent 代拟）。
  const inputMeta = input?.goal ? { goal: input.goal, outlineText: input.outline_text ?? '' } : null
  return {
    plan: active ? toPlanView(active) : null,
    job: job ? toPlanJobView(job) : null,
    input: inputMeta,
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
  return toPlanView(approved!)
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
  return toPlanView(created)
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
  return toPlanView(created)
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
