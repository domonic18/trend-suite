import 'server-only'
import type { PlanLessonEvidenceView } from '@trend-suite/contracts'
import type { SourceUnitRow } from '@/server/pipeline/processing/repo'
import { teachingPointsOf } from './planning'

/**
 * 出处明细（视图层拼装，不落库）：
 *
 * 教师要能核对「这一课真的出自我的视频哪几分钟」——只给一个匹配度分数是不够的。
 * 证据单元（source_units）带素材、时间码与讲解要点，这里把它摊成教师看得懂的明细。
 */

/** 证据单元行 → 证据明细（按开始时间排序）。 */
export function buildEvidenceMap(
  units: SourceUnitRow[],
  assetNames: Map<string, string>,
): Map<string, PlanLessonEvidenceView> {
  const map = new Map<string, PlanLessonEvidenceView>()
  for (const unit of units) {
    map.set(unit.id, {
      unitId: unit.id,
      assetId: unit.asset_id,
      assetName: assetNames.get(unit.asset_id) ?? '素材',
      startMs: unit.start_ms,
      endMs: unit.end_ms,
      points: teachingPointsOf(unit.extra),
    })
  }
  return map
}

/** 出处 id 列表 → 证据明细（按时间码排序；取不到的单元略过）。 */
export function evidenceOf(
  unitIds: string[],
  map: Map<string, PlanLessonEvidenceView>,
): PlanLessonEvidenceView[] {
  const unique = [...new Set(unitIds)]
  return unique
    .map((id) => map.get(id))
    .filter((item): item is PlanLessonEvidenceView => item !== undefined)
    .sort((a, b) => a.startMs - b.startMs || a.unitId.localeCompare(b.unitId))
}
