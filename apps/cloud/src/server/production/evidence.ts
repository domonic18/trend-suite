import 'server-only'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import * as figuresRepo from '@/server/content/textbook/repo'
import { listConceptRows } from '@/server/content/plans/repo'
import * as quotesRepo from '@/server/content/quotes/repo'
import { listSourceUnitsByCourse } from '@/server/pipeline/processing/repo'

/**
 * 生产 agent 的只读证据工具（arch/05 §8 先查再动笔）：图示与正文步动笔前
 * 检索素材单元、概念表、案例股清单与已落库图示——不提供任何写入面，
 * 产物仍只能经 write_step_output 单口出。
 */

export function evidenceTools(courseId: string, sectionId: string) {
  const searchSourceUnits = new DynamicStructuredTool({
    name: 'search_source_units',
    description:
      '按关键词检索本课程的素材证据单元（讲师转写原话与画面描述）。返回 id、素材 id、时间窗（毫秒）、转写文字、画面描述。写图示/正文前先用它找到可引用的 unitId。',
    schema: z.object({
      query: z.string().min(1).describe('关键词（转写原话或画面内容）'),
      limit: z.number().int().min(1).max(20).default(8),
    }) as never,
    func: async (input: { query: string; limit?: number }) => {
      const rows = await listSourceUnitsByCourse(courseId)
      const query = input.query.trim()
      const hits = rows
        .filter(
          (row) => row.text.includes(query) || (row.visual_desc ?? '').includes(query),
        )
        .slice(0, input.limit ?? 8)
        .map((row) => ({
          id: row.id,
          assetId: row.asset_id,
          startMs: row.start_ms,
          endMs: row.end_ms,
          text: row.text.slice(0, 400),
          visualDesc: row.visual_desc,
        }))
      return JSON.stringify(hits)
    },
  })

  const listConcepts = new DynamicStructuredTool({
    name: 'list_concepts',
    description: '列出本课程概念表（术语、别名、定义）。术语边注 :::sidenote 的 title 只能用这里面的词。',
    schema: z.object({}) as never,
    func: async () => {
      const rows = await listConceptRows(courseId)
      return JSON.stringify(
        rows.map((row) => ({ name: row.name, aliases: row.aliases, definition: row.definition })),
      )
    },
  })

  const listCaseStocks = new DynamicStructuredTool({
    name: 'list_case_stocks',
    description: '列出本节的案例股清单（代码/名称/周期/窗口）。个股锚 [[stock:code|…]] 只能引用这里面的代码。',
    schema: z.object({}) as never,
    func: async () => {
      const rows = await quotesRepo.listCaseStocks(courseId, sectionId)
      return JSON.stringify(
        rows.map((row) => ({
          code: row.code,
          name: row.name,
          exchange: row.exchange,
          period: row.period,
          windowStart: row.window_start,
          windowEnd: row.window_end,
        })),
      )
    },
  })

  const listFiguresTool = new DynamicStructuredTool({
    name: 'list_figures',
    description:
      '列出本节已落库的图示（figureId/kind/caption）。正文 :::figure 块的 figureId 只能引用这里面的 id——先写图示步才有 id 可引。',
    schema: z.object({}) as never,
    func: async () => {
      const rows = await figuresRepo.listFigures(courseId, sectionId)
      return JSON.stringify(
        rows.map((row) => ({
          figureId: row.id,
          kind: row.kind,
          caption: row.caption,
          unitId: row.unit_id,
          sec: row.sec,
        })),
      )
    },
  })

  return [searchSourceUnits, listConcepts, listCaseStocks, listFiguresTool]
}
