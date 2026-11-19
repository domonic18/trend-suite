import 'server-only'
import {
  missingRequiredAssertions,
  type WidgetIssue,
  type WidgetSpec,
} from '@trend-suite/contracts'
import { listConceptRows } from '@/server/content/plans/repo'
import * as quotesRepo from '@/server/content/quotes/repo'
import { listSourceUnitsByCourse } from '@/server/pipeline/processing/repo'
import * as textbookRepo from '@/server/content/textbook/repo'
import { proveAssertions, type AssertionProof, type WidgetAssertionDeps } from './assertions'
import { materializeWidget } from './materialize'
import * as repo from './repo'

/**
 * 课件落库编排（arch/06 §9/§11/§12）：草稿 → 物化 → 契约严校验 →
 * 逐条断言证明 → **全过才落库**（绝不部分落库）。
 *
 * 三条铁律在这里收口：
 * - 课件是 spec（数据）不是代码（物化只补机械件，不生成内容）；
 * - 图表数值不由模型生成（spec 只存生成参数，数值按生成器复算）；
 * - 断言必带且必被程序证明（任一断言不成立 → 一行不落，回灌重写）。
 */

export type PersistWidgetsResult = {
  issues: WidgetIssue[]
  notes: string[]
  persisted: number
}

export type WidgetMode = 'replay' | 'batch'

/** 落库前的依赖装配（概念词表 / 素材单元 / 本节图示集 / 案例股真实行情）。 */
async function loadDeps(courseId: string, sectionId: string): Promise<WidgetAssertionDeps> {
  const [conceptRows, unitRows, figureRows, stocks] = await Promise.all([
    listConceptRows(courseId),
    listSourceUnitsByCourse(courseId),
    textbookRepo.listFigures(courseId, sectionId),
    quotesRepo.listCaseStocks(courseId, sectionId),
  ])
  const barsByCode = new Map<string, Awaited<ReturnType<typeof quotesRepo.barsFor>>>()
  for (const stock of stocks) {
    barsByCode.set(
      stock.code,
      await quotesRepo.barsFor(stock.code, stock.period, stock.window_start, stock.window_end),
    )
  }
  return {
    terms: conceptRows.flatMap((row) => [row.name, ...(row.aliases ?? [])]),
    units: new Map(
      unitRows.map((row) => [
        row.id,
        { assetId: row.asset_id, startMs: row.start_ms, endMs: row.end_ms },
      ]),
    ),
    figureIds: new Set(figureRows.map((row) => row.id)),
    barsByCode,
  }
}

/**
 * 落库一批课件草稿。返回问题清单——非空即**一行未落**，由引擎回灌重写。
 */
export async function persistWidgets(input: {
  courseId: string
  sectionId: string
  drafts: unknown[]
  mode: WidgetMode
}): Promise<PersistWidgetsResult> {
  const issues: WidgetIssue[] = []
  const notes: string[] = []
  const specs: WidgetSpec[] = []

  for (const [index, draft] of input.drafts.entries()) {
    const materialized = materializeWidget(draft)
    if (!materialized.spec) {
      issues.push(
        ...materialized.issues.map((issue) => ({
          ...issue,
          message: `第 ${index + 1} 份课件：${issue.message}`,
        })),
      )
      continue
    }
    const spec = materialized.spec
    // 步与类型的绑定（arch/06 §2.2）：第 5 步只产回放课件，第 7 步只产其余课件。
    const wantsReplay = input.mode === 'replay'
    if (wantsReplay !== (spec.type === 'bar-replay-decision')) {
      issues.push({
        code: 'widget_spec_invalid',
        message: wantsReplay
          ? `第 ${index + 1} 份课件：回放步只接受 bar-replay-decision`
          : `第 ${index + 1} 份课件：bar-replay-decision 只能产在回放步（第 5 步）`,
        detail: spec.type,
      })
      continue
    }
    const missing = missingRequiredAssertions(spec)
    if (missing.length > 0) {
      issues.push({
        code: 'assertion_missing',
        message: `第 ${index + 1} 份课件缺必带断言：${missing.join('、')}`,
        assertion: missing[0],
      })
      continue
    }
    specs.push(spec)
  }

  if (issues.length > 0) return { issues, notes, persisted: 0 }

  const deps = await loadDeps(input.courseId, input.sectionId)
  const unitIds = new Set(deps.units.keys())
  const proven: { spec: WidgetSpec; proofs: AssertionProof[] }[] = []

  for (const [index, spec] of specs.entries()) {
    // 证据引用必须指向本课程真实存在的素材单元（arch/06 §8「citations ≥1」）。
    const unknownCitation = spec.citations.find((citation) => !unitIds.has(citation))
    if (unknownCitation) {
      issues.push({
        code: 'citation_unknown',
        message: `第 ${index + 1} 份课件引用的素材单元 ${unknownCitation} 不存在`,
        detail: unknownCitation,
      })
      continue
    }
    if (spec.type === 'bar-replay-decision' && !deps.barsByCode.has(spec.code)) {
      issues.push({
        code: 'widget_spec_invalid',
        message: `第 ${index + 1} 份回放课件的案例股 ${spec.code} 不在本节案例股清单内`,
        detail: spec.code,
      })
      continue
    }
    const result = proveAssertions(spec, deps)
    issues.push(
      ...result.issues.map((issue) => ({
        ...issue,
        message: `第 ${index + 1} 份课件：${issue.message}`,
      })),
    )
    if (result.issues.length === 0) proven.push({ spec, proofs: result.proofs })
  }

  if (issues.length > 0) return { issues, notes, persisted: 0 }

  const payloads = proven.map(({ spec, proofs }) => ({
    type: spec.type,
    code: spec.type === 'bar-replay-decision' ? spec.code : null,
    specVersion: spec.specVersion,
    spec: spec as unknown as Record<string, unknown>,
    proofs: proofs.map((proof) => ({
      assertion: proof.name,
      params: (spec.assertions[proof.name] ?? {}) as Record<string, unknown>,
      detail: proof.detail,
    })),
  }))

  if (input.mode === 'replay') {
    for (const payload of payloads) {
      if (payload.code === null) {
        issues.push({
          code: 'widget_spec_invalid',
          message: `回放课件缺 code（正文 :::replay 按 code 定位）`,
        })
        continue
      }
      await repo.upsertReplayWidget({
        courseId: input.courseId,
        sectionId: input.sectionId,
        type: payload.type,
        code: payload.code,
        specVersion: payload.specVersion,
        spec: payload.spec,
        proofs: payload.proofs,
      })
    }
  } else {
    await repo.replaceSectionWidgets({
      courseId: input.courseId,
      sectionId: input.sectionId,
      widgets: payloads,
    })
  }

  return { issues, notes, persisted: payloads.length }
}

/**
 * 回放课件的前置条件：本节有案例股且**真实行情已在缓存里**。
 * 行情源不可用 → 不产课件、步照常 done（arch/06 §5.4 的降级口径）。
 */
export async function replayMarketAvailable(courseId: string, sectionId: string): Promise<boolean> {
  const stocks = await quotesRepo.listCaseStocks(courseId, sectionId)
  if (stocks.length === 0) return false
  for (const stock of stocks) {
    const bars = await quotesRepo.barsFor(stock.code, stock.period, stock.window_start, stock.window_end)
    if (bars.length > 0) return true
  }
  return false
}
