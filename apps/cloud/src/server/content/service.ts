import 'server-only'
import {
  countOutlineLevels,
  parseOutlineText,
  type CourseSummaryView,
  type CourseStatus,
  type CourseView,
  type SessionUser,
} from '@trend-suite/contracts'
import { badRequest, forbidden, notFound } from '@/server/lib/http'
import { newId } from '@/server/lib/ids'
import * as repo from './repo'

/** 课程行里视图要用的那几列（整表行与摘要行都满足）。 */
type CourseViewRow = {
  id: string
  owner_id: string
  title: string
  status: string
  created_at: Date
  updated_at: Date
}

function toCourseView(row: CourseViewRow): CourseView {
  return {
    id: row.id,
    title: row.title,
    status: row.status as CourseStatus,
    ownerId: row.owner_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/** 骨架里层级合法的节点——jsonb 是历史数据，只认得出层级的才算数。 */
function levelNodesOf(skeleton: unknown): { level: 1 | 2 | 3 }[] {
  if (!skeleton || typeof skeleton !== 'object') return []
  const nodes = (skeleton as { nodes?: unknown }).nodes
  if (!Array.isArray(nodes)) return []
  const out: { level: 1 | 2 | 3 }[] = []
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const level = (node as { level?: unknown }).level
    if (level === 1 || level === 2 || level === 3) out.push({ level })
  }
  return out
}

function toCourseSummaryView(row: repo.CourseSummaryRow): CourseSummaryView {
  const counts = countOutlineLevels(levelNodesOf(row.plan_skeleton))
  return {
    ...toCourseView(row),
    assetCount: row.asset_count,
    readyAssetCount: row.ready_asset_count,
    planStatus: row.plan_status === 'approved' ? 'approved' : row.plan_status === 'draft' ? 'draft' : 'none',
    planVersion: row.plan_version,
    chapterCount: counts.chapters,
    lessonCount: counts.lessons,
    sectionCount: row.section_count,
    doneSectionCount: row.done_section_count,
  }
}

/**
 * 新建课程（恒为草稿——producer 只写草稿，签批与发布是运营的事，arch/01 端职责边界）。
 *
 * 建课时可以一次给齐：课程名、目标、人工目录先验、参与建设的素材。
 * 素材来自素材库（跨课程的全局视角），可以选用别的课的素材——归属课程不变，
 * 这门课把它选进来用（勾选关系落 courses.plan_asset_ids）。
 */
export async function createCourse(
  ownerId: string,
  title: string,
  input: { outlineText?: string; goal?: string; assetIds?: string[] } = {},
): Promise<CourseView> {
  // 目录先验：文本与目录树同源。认不出的层级不拦建课——教师可在方案页改格式重提。
  const text = (input.outlineText ?? '').trim()
  let outline: unknown
  if (text.length > 0) {
    const parsed = parseOutlineText(text)
    if (parsed.issues.length === 0) outline = { nodes: parsed.nodes }
  }
  const assetIds = (input.assetIds ?? []).filter((id) => id.length > 0)
  if (assetIds.length > 0) {
    const owned = await repo.listOwnedAssetIds(ownerId, assetIds)
    if (owned.length !== assetIds.length) {
      throw badRequest('素材不存在或不属于你', { path: 'assetIds', message: '请重新选择素材' })
    }
  }
  const goal = (input.goal ?? '').trim()
  const row = await repo.insertCourse({
    id: newId('course'),
    ownerId,
    title,
    ...(text.length > 0 ? { outlineText: text } : {}),
    ...(outline === undefined ? {} : { outline }),
    ...(goal.length > 0 ? { goal } : {}),
    ...(assetIds.length > 0 ? { planAssetIds: assetIds } : {}),
    // 有目录先验就沿用它做骨架；没有就让 Agent 依据目标与素材代拟一版。
    planMode: text.length > 0 ? 'follow_manual' : 'smart',
  })
  return toCourseView(row)
}

/** 教师看自己的课；运营与管理员看全部。 */
export function listCoursesFor(user: SessionUser): Promise<CourseView[]> {
  const rows =
    user.role === 'producer'
      ? repo.listCoursesByOwner(user.id)
      : repo.listAllCourses()
  return rows.then((list) => list.map(toCourseView))
}

/**
 * 课程列表（带进度摘要）：教师看自己的课；运营与管理员看全部。
 *
 * 工作台的课程卡与侧栏要显示「这门课到哪一步了」——素材数、方案状态、
 * 生产节数都从这里出，前端不再自己拼。
 */
export async function listCourseSummariesFor(user: SessionUser): Promise<CourseSummaryView[]> {
  const rows = await repo.listCourseSummaries(user.role === 'producer' ? user.id : null)
  return rows.map(toCourseSummaryView)
}

/**
 * 取一门课并校验可见性：教师只能碰自己的课，运营与管理员不限。
 * 素材、方案、生产等一切挂在课程下的动作都走这里。
 */
export async function getCourseForUser(user: SessionUser, courseId: string): Promise<CourseView> {
  const row = await repo.findCourseById(courseId)
  if (!row) throw notFound('课程不存在')
  if (user.role === 'producer' && row.owner_id !== user.id) {
    throw forbidden('该课程不属于你')
  }
  return toCourseView(row)
}

/** 改名（教师只能改自己的课；运营与管理员不限）。 */
export async function renameCourse(user: SessionUser, courseId: string, title: string): Promise<CourseView> {
  await getCourseForUser(user, courseId)
  const row = await repo.updateCourseTitle(courseId, title.trim())
  if (!row) throw notFound('课程不存在')
  return toCourseView(row)
}

/**
 * 删除课程：挂在其下的素材、方案、生产与对话线程一并级联删除，不可恢复。
 * 幂等：课程不存在（已删过 / 列表 stale）视为删除成功——前端二次点击不再报 404。
 */
export async function deleteCourse(user: SessionUser, courseId: string): Promise<void> {
  const row = await repo.findCourseById(courseId)
  if (!row) return
  if (user.role === 'producer' && row.owner_id !== user.id) {
    throw forbidden('该课程不属于你')
  }
  await repo.deleteCourseById(courseId)
}
