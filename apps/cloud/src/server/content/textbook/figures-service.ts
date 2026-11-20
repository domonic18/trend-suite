import 'server-only'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  figureQuotas,
  generatedChapterMax,
  generatedCourseMax,
  type DslIssue,
  type FigureKind,
} from '@trend-suite/contracts'
import type { FetchLike } from '@/server/content/agents/llm'
import { runImageGeneration } from '@/server/content/agents/image'
import { LlmError } from '@/server/content/agents/llm'
import { newId } from '@/server/lib/ids'
import { getMediaStore } from '@/server/pipeline/store'
import { extractFrameAt } from '@/server/pipeline/processing/frames'
import * as procRepo from '@/server/pipeline/processing/repo'
import { renderDiagram } from './diagram-renderer'
import { diagramParamsByTemplate } from '@trend-suite/contracts'
import * as repo from './repo'

/**
 * 图示三路落库编排（arch/05 §8 / arch/06 §3）：keyframe 按 source unit 时间戳
 * 选帧（无帧 ffmpeg 补抽）、diagram 确定性渲 SVG、generated 文生图（仅装饰）。
 *
 * 失败语义：
 * - 配额越界（keyframe/diagram）→ 阻塞性 issue，引擎回灌重写（验收③）；
 * - unitId 不存在 / sec 落窗外 / diagram 模板或参数不合法 → 阻塞性 issue 回灌；
 * - generated 一切失败（含未绑模型）→ 剔除 + note，不挂步——装饰图禁止承载
 *   教学信息，缺它不损 grounded。
 */

export type FigureSpec =
  | { kind: 'keyframe'; caption: string; unitId: string; secHint?: number }
  | { kind: 'diagram'; caption: string; unitId?: string; template: string; params: Record<string, unknown> }
  | { kind: 'generated'; caption: string; prompt: string }

export type PersistFiguresResult = {
  issues: DslIssue[]
  notes: string[]
}

const KEYFRAME_TOLERANCE_MS = 2_000

export async function persistFigures(input: {
  courseId: string
  sectionId: string
  specs: FigureSpec[]
  fetchImpl?: FetchLike
}): Promise<PersistFiguresResult> {
  const issues: DslIssue[] = []
  const notes: string[] = []

  const existing = await repo.listFigures(input.courseId, input.sectionId)
  const existingByKey = new Map(existing.map((row) => [`${row.kind}\n${row.caption}`, row]))

  // 配额预检：计入覆盖更新（同 kind 同 caption 复用原行），只算净新增。
  const counts = new Map<FigureKind, number>([
    ['keyframe', existing.filter((f) => f.kind === 'keyframe').length],
    ['diagram', existing.filter((f) => f.kind === 'diagram').length],
    ['generated', existing.filter((f) => f.kind === 'generated').length],
  ])
  for (const spec of input.specs) {
    const known = existingByKey.has(`${spec.kind}\n${spec.caption}`)
    if (!known) counts.set(spec.kind, (counts.get(spec.kind) ?? 0) + 1)
  }
  const keyframeQuota = figureQuotas.keyframe
  if ((counts.get('keyframe') ?? 0) > keyframeQuota) {
    issues.push({
      code: 'keyframe_quota_exceeded',
      line: null,
      message: `keyframe 图示超出每节配额（≤${keyframeQuota}，本节将达 ${counts.get('keyframe')} 张）`,
    })
  }
  const diagramQuota = figureQuotas.diagram
  if ((counts.get('diagram') ?? 0) > diagramQuota) {
    issues.push({
      code: 'diagram_quota_exceeded',
      line: null,
      message: `diagram 图示超出每节配额（≤${diagramQuota}，本节将达 ${counts.get('diagram')} 张）`,
    })
  }

  // 阻塞性配额已破：不落任何行，直接回灌（引擎喂回重写）。
  if (issues.length > 0) return { issues, notes }

  const unitRows = await procRepo.listSourceUnitsByCourse(input.courseId)
  const unitById = new Map(unitRows.map((row) => [row.id, row]))

  // generated 章/课配额：章 = section_id 前缀（'1-1' → '1'）。超限剔除 + note，不挂步。
  const chapterOf = (sectionId: string): string => sectionId.split('-')[0] ?? sectionId
  const courseFigures = await repo.listCourseFigures(input.courseId)
  const chapterCount = new Map<string, number>()
  let courseGenerated = 0
  for (const row of courseFigures) {
    if (row.kind !== 'generated') continue
    courseGenerated += 1
    const chapter = chapterOf(row.section_id)
    chapterCount.set(chapter, (chapterCount.get(chapter) ?? 0) + 1)
  }

  for (const spec of input.specs) {
    if (spec.kind === 'generated') {
      const chapter = chapterOf(input.sectionId)
      const inChapter = chapterCount.get(chapter) ?? 0
      if (inChapter >= generatedChapterMax || courseGenerated >= generatedCourseMax) {
        notes.push(
          courseGenerated >= generatedCourseMax
            ? `装饰图「${spec.caption}」剔除：全课 generated 已达 ${generatedCourseMax} 张上限`
            : `装饰图「${spec.caption}」剔除：本章 generated 已达 ${generatedChapterMax} 张上限`,
        )
        continue
      }
    }

    const reused = existingByKey.get(`${spec.kind}\n${spec.caption}`)
    const figureId = reused?.id ?? newId('figure')

    if (spec.kind === 'keyframe') {
      const outcome = await resolveKeyframe({
        figureId,
        spec,
        unitById,
      })
      if (outcome.issue) {
        issues.push(outcome.issue)
        continue
      }
      await repo.upsertFigure({
        id: figureId,
        courseId: input.courseId,
        sectionId: input.sectionId,
        kind: 'keyframe',
        caption: spec.caption,
        unitId: spec.unitId,
        assetId: outcome.assetId,
        sec: outcome.sec,
        template: null,
        params: null,
        prompt: null,
        imageModelId: null,
        path: null,
        frameId: outcome.frameId,
        svg: null,
      })
      continue
    }

    if (spec.kind === 'diagram') {
      const template = spec.template
      if (!(template in diagramParamsByTemplate)) {
        issues.push({
          code: 'template_not_allowed',
          line: null,
          message: `diagram「${spec.caption}」模板 ${template} 不在白名单（chip-contrast/chip-horizontal/timeline/stat-inline）`,
        })
        continue
      }
      const parsed = diagramParamsByTemplate[template as keyof typeof diagramParamsByTemplate].safeParse(
        spec.params,
      )
      if (!parsed.success) {
        issues.push({
          code: 'params_schema_failed',
          line: null,
          message: `diagram「${spec.caption}」参数不符合模板 ${template} 约定：${parsed.error.message.slice(0, 160)}`,
        })
        continue
      }
      const { svg } = renderDiagram(template as keyof typeof diagramParamsByTemplate, parsed.data)
      await repo.upsertFigure({
        id: figureId,
        courseId: input.courseId,
        sectionId: input.sectionId,
        kind: 'diagram',
        caption: spec.caption,
        unitId: spec.unitId ?? null,
        assetId: null,
        sec: null,
        template,
        params: parsed.data as Record<string, unknown>,
        prompt: null,
        imageModelId: null,
        path: null,
        frameId: null,
        svg,
      })
      continue
    }

    // generated：一切失败都剔除 + note，不挂步。
    try {
      const run = await runImageGeneration({
        prompt: spec.prompt,
        refType: 'figure',
        refId: figureId,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      })
      const store = getMediaStore()
      const dir = store.figuresDir(figureId)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'gen.jpg')
      await writeFile(file, Buffer.from(run.base64, 'base64'))
      await repo.upsertFigure({
        id: figureId,
        courseId: input.courseId,
        sectionId: input.sectionId,
        kind: 'generated',
        caption: spec.caption,
        unitId: null,
        assetId: null,
        sec: null,
        template: null,
        params: null,
        prompt: spec.prompt.slice(0, 2000),
        imageModelId: run.modelId,
        path: file,
        frameId: null,
        svg: null,
      })
      chapterCount.set(chapterOf(input.sectionId), (chapterCount.get(chapterOf(input.sectionId)) ?? 0) + 1)
      courseGenerated += 1
    } catch (err) {
      const reason =
        err instanceof LlmError && err.code === 'model_not_configured'
          ? '未配置文生图模型'
          : (err as Error).message.slice(0, 120)
      notes.push(`装饰图「${spec.caption}」剔除：${reason}`)
    }
  }

  return { issues, notes }
}

async function resolveKeyframe(input: {
  figureId: string
  spec: Extract<FigureSpec, { kind: 'keyframe' }>
  unitById: Map<string, procRepo.SourceUnitRow>
}): Promise<
  | { issue: DslIssue }
  | { issue: null; assetId: string; sec: number; frameId: string | null }
> {
  const unit = input.unitById.get(input.spec.unitId)
  if (!unit) {
    return {
      issue: {
        code: 'unit_ref_unknown',
        line: null,
        message: `keyframe「${input.spec.caption}」的 unitId=${input.spec.unitId} 在本课程素材单元中不存在`,
      },
    }
  }

  // sec 必须落 unit 窗内（缺省取单元中点）；帧按 ±2s 容差选最近帧。
  const sec = input.spec.secHint ?? Math.round((unit.start_ms + unit.end_ms) / 2000)
  if (sec * 1000 < unit.start_ms || sec * 1000 > unit.end_ms) {
    return {
      issue: {
        code: 'sec_not_grounded',
        line: null,
        message: `keyframe「${input.spec.caption}」的 sec=${sec}s 落在素材单元窗外（${(unit.start_ms / 1000).toFixed(1)}s ~ ${(unit.end_ms / 1000).toFixed(1)}s）`,
      },
    }
  }

  const frames = await procRepo.listFrames(unit.asset_id)
  const atMs = sec * 1000
  let nearest: procRepo.MediaFrameRow | null = null
  for (const frame of frames) {
    if (Math.abs(frame.at_ms - atMs) > KEYFRAME_TOLERANCE_MS) continue
    if (!nearest || Math.abs(frame.at_ms - atMs) < Math.abs(nearest.at_ms - atMs)) nearest = frame
  }

  let frameId: string | null = nearest?.id ?? null
  if (!nearest) {
    // 帧轨道无落点帧：ffmpeg 补抽单帧（源文件走媒体存储解析；源不可读 → 阻塞）。
    try {
      const store = getMediaStore()
      const sourcePath = await store.sourcePath(unit.asset_id)
      const dir = store.framesDir(unit.asset_id)
      const output = join(dir, `${atMs}.jpg`)
      const extracted = await extractFrameAt({ sourcePath, atMs, output })
      if (!extracted) {
        return {
          issue: {
            code: 'figure_not_grounded',
            line: null,
            message: `keyframe「${input.spec.caption}」在 ${sec}s 附近无帧且补抽失败`,
          },
        }
      }
      await procRepo.upsertFrames({
        assetId: unit.asset_id,
        frames: [{ atMs, path: extracted.path, width: null, height: null }],
      })
      const inserted = await procRepo.listFrames(unit.asset_id)
      const match = inserted.find((f) => f.at_ms === atMs)
      frameId = match?.id ?? null
    } catch (err) {
      return {
        issue: {
          code: 'figure_not_grounded',
          line: null,
          message: `keyframe「${input.spec.caption}」补抽帧失败：${(err as Error).message.slice(0, 120)}`,
        },
      }
    }
  }

  return { issue: null, assetId: unit.asset_id, sec, frameId }
}
