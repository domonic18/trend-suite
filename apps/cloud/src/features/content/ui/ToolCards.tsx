'use client'

import { useState } from 'react'
import type { PlanConceptMapView, PlanGlossaryView } from '@trend-suite/contracts'

/**
 * 折叠工具卡：术语与概念图谱（术语校验基准与图谱同源）。
 *
 * 分节计划不再单列一张表——课时就是大纲树里的课行，在那里改更顺手。
 */
export function ToolCards({
  conceptMap,
  glossary,
  onAddAlias,
  busy,
}: {
  conceptMap: PlanConceptMapView
  glossary: PlanGlossaryView
  onAddAlias: (conceptId: string, alias: string) => void
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
    </>
  )
}
