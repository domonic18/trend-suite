'use client'

import { Button } from '@/components/ui/button'

import { useMemo, useState } from 'react'
import type { WidgetView } from '@trend-suite/contracts'
import { branchingNodes, pathMatchesOptimal } from '../widgetView'

/**
 * 概念与路径类课件：术语卡、知识时间线、分支决策情景。
 * 学员作答只在本机即时反馈（arch/06 §11），不落库、不上报。
 */

/** flashcards：术语卡（翻面自测）。 */
export function Flashcards({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  if (spec.type !== 'flashcards') return null
  const card = spec.cards[index]
  return (
    <div className="widget-card">
      <div className="widget-progress">
        第 {index + 1} / {spec.cards.length} 张 · {card?.conceptRef ?? ''}
      </div>
      <button type="button" className="widget-flashcard" onClick={() => setFlipped((v) => !v)}>
        <b>{card?.front}</b>
        {flipped ? <span>{card?.back}</span> : <span className="meta">点击翻面</span>}
      </button>
      <div className="widget-actions">
        <Button
          variant="outline" size="sm"
          disabled={index === 0}
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1))
            setFlipped(false)
          }}
        >
          上一张
        </Button>
        <Button
          variant="outline" size="sm"
          disabled={index >= spec.cards.length - 1}
          onClick={() => {
            setIndex((i) => Math.min(spec.cards.length - 1, i + 1))
            setFlipped(false)
          }}
        >
          下一张
        </Button>
      </div>
    </div>
  )
}

/** timeline-explorer：概念依赖浏览（前置 / 相关）。 */
export function TimelineExplorer({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const rows = useMemo(() => {
    if (spec.type !== 'timeline-explorer') return []
    return spec.nodes.map((node) => ({
      concept: node.conceptRef,
      prereq: spec.edges.filter((edge) => edge.to === node.conceptRef && edge.kind === 'prerequisite').map((edge) => edge.from),
      related: spec.edges.filter((edge) => edge.to === node.conceptRef && edge.kind === 'related').map((edge) => edge.from),
    }))
  }, [spec])
  if (spec.type !== 'timeline-explorer') return null
  return (
    <div className="widget-card">
      <table className="widget-table">
        <thead>
          <tr>
            <th>概念</th>
            <th>前置</th>
            <th>相关</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.concept}>
              <td>
                <b>{row.concept}</b>
              </td>
              <td>{row.prereq.length > 0 ? row.prereq.join('、') : '—'}</td>
              <td>{row.related.length > 0 ? row.related.join('、') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** branching-scenario：决策树情境练习（逐节点作答 + 即时反馈 + 路径对照）。 */
export function BranchingScenario({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const nodes = useMemo(() => branchingNodes(spec), [spec])
  const [nodeId, setNodeId] = useState<string | null>(spec.type === 'branching-scenario' ? spec.entryId : null)
  const [picked, setPicked] = useState<number | null>(null)
  const [path, setPath] = useState<string[]>([])
  if (spec.type !== 'branching-scenario') return null
  const node = nodes.find((item) => item.id === nodeId) ?? null
  const option = picked !== null ? node?.options[picked] : undefined
  const finished = node === null
  const optimal = pathMatchesOptimal(spec, path)

  return (
    <div className="widget-card">
      <p className="widget-q">{spec.scenario}</p>
      {node ? (
        <>
          <p className="widget-prompt">{node.prompt}</p>
          <div className="widget-options column">
            {node.options.map((item, index) => (
              <button
                key={`${node.id}-${index}`}
                type="button"
                className={`widget-option${picked === index ? ' on' : ''}`}
                onClick={() => setPicked(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {option ? (
            <>
              <p className="widget-feedback">{option.feedback}</p>
              <div className="widget-actions">
                <Button
                  variant="outline" size="sm"
                  onClick={() => {
                    const next = option.next
                    setPath((current) => [...current, node.id])
                    setNodeId(next)
                    setPicked(null)
                  }}
                >
                  {option.next ? '继续' : '结束'}
                </Button>
                <Button variant="link" size="sm" onClick={() => { setNodeId(spec.entryId); setPath([]); setPicked(null) }}>
                  重走
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <div className="widget-summary">
          <b>走到终点</b>
          <p>
            走过的路径：{path.join(' → ') || '（直接结束）'}
          </p>
          <p className={optimal ? 'ok' : 'bad'}>
            {optimal ? '✓ 与最优路径一致' : '✕ 与最优路径不一致'}（最优：{spec.optimalPath.join(' → ')}）
          </p>
          <Button variant="link" size="sm" onClick={() => { setNodeId(spec.entryId); setPath([]); setPicked(null) }}>
            重走
          </Button>
        </div>
      )}
    </div>
  )
}
