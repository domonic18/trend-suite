import 'server-only'
import {
  type SectionContentView,
  type SourceUnitView,
  type SessionUser,
} from '@trend-suite/contracts'
import { getCourseForUser } from '@/server/content/service'
import { listConceptRows } from '@/server/content/plans/repo'
import * as quotesRepo from '@/server/content/quotes/repo'
import { notFound } from '@/server/lib/http'
import { signFrameUrl } from '@/server/pipeline/processing/frame-url'
import { listSourceUnitsByCourse, type SourceUnitRow } from '@/server/pipeline/processing/repo'
import { collectUnitRefs, parseDsl } from './dsl-parser'
import { signFigureUrl } from './figure-url'
import * as repo from './repo'

/**
 * 节教材内容视图（迭代 6）：正文 DSL 原文 + 三路图示（带签名 URL）+
 * 被正文引用的 source units 内联展开 + 案例股清单——管理台预览单次取全，
 * 锚点回溯不出二次请求（arch/06 §1 渲染同源：学员端后续复用同一组件）。
 */

export async function getSectionContent(
  user: SessionUser,
  courseId: string,
  sectionId: string,
): Promise<{ content: SectionContentView }> {
  await getCourseForUser(user, courseId)

  const section = await repo.findSectionContent(courseId, sectionId)
  if (!section) throw notFound('节不存在')

  const figures = await repo.listFigures(courseId, sectionId)
  const body = section.body
  const unitIds = body ? collectUnitRefs(parseDsl(body)) : []
  const unitRows = await loadUnitsByIds(courseId, unitIds)
  const assetsHls = await repo.listAssetsHlsByIds([
    ...new Set([...unitRows.values()].map((row) => row.asset_id)),
  ])
  const stocks = await quotesRepo.listCaseStocks(courseId, sectionId)

  const unitViews: SourceUnitView[] = unitIds.flatMap((unitId): SourceUnitView[] => {
    const row = unitRows.get(unitId)
    if (!row) return []
    const extra = (row.extra ?? {}) as {
      chartType?: unknown
      teachingPoints?: unknown
      frameIds?: unknown
    }
    return [
      {
        id: row.id,
        assetId: row.asset_id,
        startMs: row.start_ms,
        endMs: row.end_ms,
        text: row.text,
        visualDesc: row.visual_desc,
        chartType: typeof extra.chartType === 'string' ? extra.chartType : null,
        teachingPoints: Array.isArray(extra.teachingPoints)
          ? extra.teachingPoints.filter((p): p is string => typeof p === 'string')
          : [],
        frameIds: Array.isArray(extra.frameIds)
          ? extra.frameIds.filter((id): id is string => typeof id === 'string')
          : [],
        playable: assetsHls.get(row.asset_id) ?? false,
      },
    ]
  })

  return {
    content: {
      courseId,
      sectionId,
      title: section.title,
      dslVersion: section.dsl_version,
      body: section.body,
      bodyStatus: section.body_status,
      figures: figures.map((row) => ({
        id: row.id,
        sectionId: row.section_id,
        kind: row.kind,
        caption: row.caption,
        unitId: row.unit_id,
        assetId: row.asset_id,
        sec: row.sec,
        template: (row.template as SectionContentView['figures'][number]['template']) ?? null,
        params: row.params,
        svg: row.svg,
        url:
          row.kind === 'keyframe' && row.asset_id && row.frame_id
            ? signFrameUrl({ assetId: row.asset_id, frameId: row.frame_id })
            : row.kind === 'generated'
              ? signFigureUrl({ figureId: row.id })
              : null,
        prompt: row.prompt,
      })),
      units: unitViews,
      caseStocks: stocks.map((stock) => ({
        id: stock.id,
        code: stock.code,
        name: stock.name,
        exchange: stock.exchange,
        period: stock.period,
        windowStart: stock.window_start,
        windowEnd: stock.window_end,
        events: stock.events,
        notes: stock.notes,
      })),
    },
  }
}

async function loadUnitsByIds(
  courseId: string,
  unitIds: string[],
): Promise<Map<string, SourceUnitRow>> {
  if (unitIds.length === 0) return new Map()
  const rows = await listSourceUnitsByCourse(courseId)
  const wanted = new Set(unitIds)
  return new Map(rows.filter((row) => wanted.has(row.id)).map((row) => [row.id, row]))
}

/** 概念词表（name + aliases 原样），正文校验器注入用。 */
export async function conceptTerms(courseId: string): Promise<string[]> {
  const rows = await listConceptRows(courseId)
  return rows.flatMap((row) => [row.name, ...(row.aliases ?? [])])
}
