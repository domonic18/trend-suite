import 'server-only'
import { query, queryOne } from '@/server/lib/db'

/**
 * 教材正文与图示的数据访问（arch/03 §2.2，迁移 011）：
 * - figures (course_id, section_id, kind, caption) 唯一 = 覆盖更新锚点（figureId 不变）；
 * - sections 正文列只在校验通过后写（body_status none/draft/rejected）。
 */

export type FigureRow = {
  id: string
  course_id: string
  section_id: string
  kind: 'keyframe' | 'diagram' | 'generated'
  caption: string
  unit_id: string | null
  asset_id: string | null
  sec: number | null
  template: string | null
  params: Record<string, unknown> | null
  prompt: string | null
  image_model_id: string | null
  path: string | null
  frame_id: string | null
  svg: string | null
  created_at: Date
  updated_at: Date
}

const FIGURE_COLUMNS = [
  'id',
  'course_id',
  'section_id',
  'kind',
  'caption',
  'unit_id',
  'asset_id',
  'sec',
  'template',
  'params',
  'prompt',
  'image_model_id',
  'path',
  'frame_id',
  'svg',
  'created_at',
  'updated_at',
].join(', ')

export function listFigures(courseId: string, sectionId: string): Promise<FigureRow[]> {
  return query<FigureRow>(
    `SELECT ${FIGURE_COLUMNS} FROM figures
     WHERE course_id = $1 AND section_id = $2
     ORDER BY created_at ASC, id ASC`,
    [courseId, sectionId],
  )
}

export function listCourseFigures(courseId: string): Promise<FigureRow[]> {
  return query<FigureRow>(
    `SELECT ${FIGURE_COLUMNS} FROM figures WHERE course_id = $1 ORDER BY created_at ASC, id ASC`,
    [courseId],
  )
}

export function findFigureById(figureId: string): Promise<FigureRow | null> {
  return queryOne<FigureRow>(`SELECT ${FIGURE_COLUMNS} FROM figures WHERE id = $1`, [figureId])
}

/** 覆盖写一张图：命中 (course, section, kind, caption) 时保留原 figureId。 */
export async function upsertFigure(input: {
  id: string
  courseId: string
  sectionId: string
  kind: FigureRow['kind']
  caption: string
  unitId: string | null
  assetId: string | null
  sec: number | null
  template: string | null
  params: Record<string, unknown> | null
  prompt: string | null
  imageModelId: string | null
  path: string | null
  frameId: string | null
  svg: string | null
}): Promise<void> {
  await query(
    `INSERT INTO figures
       (id, course_id, section_id, kind, caption, unit_id, asset_id, sec,
        template, params, prompt, image_model_id, path, frame_id, svg)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15)
     ON CONFLICT (course_id, section_id, kind, caption) DO UPDATE SET
       unit_id = EXCLUDED.unit_id,
       asset_id = EXCLUDED.asset_id,
       sec = EXCLUDED.sec,
       template = EXCLUDED.template,
       params = EXCLUDED.params,
       prompt = EXCLUDED.prompt,
       image_model_id = EXCLUDED.image_model_id,
       path = EXCLUDED.path,
       frame_id = EXCLUDED.frame_id,
       svg = EXCLUDED.svg,
       updated_at = now()`,
    [
      input.id,
      input.courseId,
      input.sectionId,
      input.kind,
      input.caption,
      input.unitId,
      input.assetId,
      input.sec,
      input.template,
      input.params === null ? null : JSON.stringify(input.params),
      input.prompt,
      input.imageModelId,
      input.path,
      input.frameId,
      input.svg,
    ],
  )
}

// ---------------------------------------------------------------- sections 正文列

export type SectionContentRow = {
  id: string
  course_id: string
  section_id: string
  title: string
  sort_order: number
  status: 'pending' | 'complete'
  dsl_version: number | null
  body: string | null
  body_status: 'none' | 'draft' | 'rejected'
  placeholder: Record<string, unknown>
}

const SECTION_CONTENT_COLUMNS =
  'id, course_id, section_id, title, sort_order, status, dsl_version, body, body_status, placeholder'

export function findSectionContent(courseId: string, sectionId: string): Promise<SectionContentRow | null> {
  return queryOne<SectionContentRow>(
    `SELECT ${SECTION_CONTENT_COLUMNS} FROM sections WHERE course_id = $1 AND section_id = $2`,
    [courseId, sectionId],
  )
}

/** 正文只在三层校验（模型自查 → 云端复检 → schema）通过后整体落列（绝不部分落库）。 */
export async function saveSectionBody(input: {
  courseId: string
  sectionId: string
  dslVersion: number
  body: string
}): Promise<void> {
  await query(
    `UPDATE sections
     SET dsl_version = $3, body = $4, body_status = 'draft', updated_at = now()
     WHERE course_id = $1 AND section_id = $2`,
    [input.courseId, input.sectionId, input.dslVersion, input.body],
  )
}

export async function saveSectionBodyRejected(input: {
  courseId: string
  sectionId: string
  body: string
  dslVersion: number
}): Promise<void> {
  await query(
    `UPDATE sections
     SET dsl_version = $3, body = $4, body_status = 'rejected', updated_at = now()
     WHERE course_id = $1 AND section_id = $2`,
    [input.courseId, input.sectionId, input.dslVersion, input.body],
  )
}

// ---------------------------------------------------------------- 播放就绪探测

/** 素材 id → 是否已产出 HLS（content 视图的 playable 标志）。 */
export async function listAssetsHlsByIds(
  assetIds: string[],
): Promise<Map<string, boolean>> {
  if (assetIds.length === 0) return new Map()
  const rows = await query<{ id: string; hls_path: string | null }>(
    `SELECT id, hls_path FROM media_assets WHERE id = ANY($1::text[])`,
    [assetIds],
  )
  return new Map(rows.map((row) => [row.id, row.hls_path !== null]))
}
