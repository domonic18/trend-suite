'use client'

import { useState } from 'react'
import type { PlanConceptMapView, PlanGlossaryView, PlanSectionPlanView } from '@trend-suite/contracts'
import { evidenceDetailLinesOf, evidenceSummaryOf } from './planAudit'

/** 折叠工具卡：概念图谱 + 术语表 + 分节计划（术语校验基准与图谱同源）。 */
export function ToolCards({
  conceptMap,
  glossary,
  sectionPlan,
  onSetGranularity,
  onAddAlias,
  onReorderLessons,
  busy,
}: {
  conceptMap: PlanConceptMapView
  glossary: PlanGlossaryView
  sectionPlan: PlanSectionPlanView
  onSetGranularity: (lessonId: string, subLessonCount: number) => void
  onAddAlias: (conceptId: string, alias: string) => void
  /** 重排课时：给出目标顺序的课时 id 数组。 */
  onReorderLessons: (lessonIds: string[]) => void
  busy: boolean
}) {
  const [aliasFor, setAliasFor] = useState<string | null>(null)
  const [aliasText, setAliasText] = useState('')

  const nameById = new Map(conceptMap.concepts.map((concept) => [concept.id, concept.name]))
  const aliasCount = conceptMap.concepts.reduce((sum, concept) => sum + concept.aliases.length, 0)

  return (
    <>
      <details className="toolcard">
        <summary>
          <span className="tname">术语与概念图谱</span>
          <span className="targs">
            {conceptMap.concepts.length} 术语 · {aliasCount} 别名
          </span>
        </summary>
        <div className="tout grid2">
          <div>
            <div className="sec-title">
              概念图谱 <span className="n">{conceptMap.edges.length} 条依赖</span>
            </div>
            <table className="mini-tbl">
              <thead>
                <tr>
                  <th>术语</th>
                  <th>别名</th>
                  <th>依赖</th>
                </tr>
              </thead>
              <tbody>
                {conceptMap.concepts.map((concept) => (
                  <tr key={concept.id}>
                    <td>{concept.name}</td>
                    <td>{concept.aliases.length > 0 ? concept.aliases.join('、') : '—'}</td>
                    <td>
                      {conceptMap.edges
                        .filter((edge) => edge.fromId === concept.id)
                        .map((edge) => nameById.get(edge.toId) ?? '')
                        .filter(Boolean)
                        .join('、') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="sec-title">
              术语表 <span className="n">正文与课件校验基准</span>
            </div>
            <table className="mini-tbl">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>别名</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {glossary.items.map((item) => (
                  <tr key={item.term}>
                    <td>{item.term}</td>
                    <td>
                      {item.aliases.length > 0 ? item.aliases.join('、') : '—'}
                      <button
                        type="button"
                        className="btn link"
                        disabled={busy}
                        onClick={() => {
                          setAliasFor(item.term)
                          setAliasText('')
                        }}
                      >
                        ＋别名
                      </button>
                      {aliasFor === item.term ? (
                        <span className="oe-inline">
                          <input
                            value={aliasText}
                            maxLength={120}
                            onChange={(e) => setAliasText(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn link"
                            disabled={busy || aliasText.trim().length === 0}
                            onClick={() => {
                              const concept = conceptMap.concepts.find((c) => c.name === item.term)
                              if (concept) onAddAlias(concept.id, aliasText.trim())
                              setAliasFor(null)
                            }}
                          >
                            存
                          </button>
                          <button type="button" className="btn link" onClick={() => setAliasFor(null)}>
                            取消
                          </button>
                        </span>
                      ) : null}
                    </td>
                    <td>{item.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className="toolcard">
        <summary>
          <span className="tname">分节计划</span>
          <span className="targs">{sectionPlan.lessons.length} 节</span>
        </summary>
        <div className="tout">
          <table className="mini-tbl">
            <thead>
              <tr>
                <th>节</th>
                <th>子节数</th>
                <th>预估时长</th>
                <th>出处</th>
                <th>并行</th>
                <th>顺序</th>
              </tr>
            </thead>
            <tbody>
              {sectionPlan.lessons.map((lesson, index) => (
                <tr key={lesson.id}>
                  <td>{lesson.title}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      defaultValue={lesson.subLessonCount}
                      onBlur={(e) => {
                        const next = Number(e.target.value)
                        if (next !== lesson.subLessonCount && next >= 1 && next <= 20) {
                          onSetGranularity(lesson.id, next)
                        }
                      }}
                    />
                  </td>
                  <td>{lesson.estimatedMinutes} 分钟</td>
                  <td
                    className="evidence-cell"
                    title={evidenceDetailLinesOf(lesson.evidence).join('\n')}
                  >
                    {evidenceSummaryOf(lesson.evidence) ?? '—'}
                  </td>
                  <td>slot {lesson.parallelSlot}</td>
                  <td>
                    <button
                      type="button"
                      className="iconbtn"
                      title="上移"
                      aria-label="上移"
                      disabled={busy || index === 0}
                      onClick={() => {
                        const ids = sectionPlan.lessons.map((item) => item.id)
                        const target = index - 1
                        const swapped = [...ids]
                        swapped[target] = ids[index]!
                        swapped[index] = ids[target]!
                        onReorderLessons(swapped)
                      }}
                    >
                      上
                    </button>
                    <button
                      type="button"
                      className="iconbtn"
                      title="下移"
                      aria-label="下移"
                      disabled={busy || index === sectionPlan.lessons.length - 1}
                      onClick={() => {
                        const ids = sectionPlan.lessons.map((item) => item.id)
                        const target = index + 1
                        const swapped = [...ids]
                        swapped[target] = ids[index]!
                        swapped[index] = ids[target]!
                        onReorderLessons(swapped)
                      }}
                    >
                      下
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  )
}
