'use client'

import { useMemo, useState } from 'react'
import { CALC_PARAM_KEYS, calcFormula, type WidgetView } from '@trend-suite/contracts'
import { MiniChart } from '../MiniChart'
import {
  CALC_FORMULA_LABELS,
  calcRows,
  mcqVerdict,
  patternOptionViews,
  patternVerdict,
} from '../widgetView'

/**
 * 不依赖图表的互动课件：选择题、形态识别题、计算训练器、检查清单。
 * 学员作答只在本机即时反馈（arch/06 §11 隐私护栏）——不落库、不上报。
 */

/** mcq-quiz：概念选择题。 */
export function McqQuiz({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [selected, setSelected] = useState<string | null>(null)
  if (spec.type !== 'mcq-quiz') return null
  const verdict = mcqVerdict(spec, selected)
  return (
    <div className="widget-card">
      <p className="widget-q">{spec.question}</p>
      <div className="widget-options">
        {spec.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`widget-option${selected === option.id ? ' on' : ''}`}
            onClick={() => setSelected(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {verdict ? (
        <div className={`widget-feedback ${verdict.correct ? 'ok' : 'bad'}`}>
          {verdict.correct ? '✓' : '✕'} {verdict.explain}
          {!verdict.correct ? `（正确答案：${verdict.answerText}）` : ''}
        </div>
      ) : null}
    </div>
  )
}

/** pattern-quiz：形态识别（选图）。 */
export function PatternQuiz({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [selected, setSelected] = useState<string | null>(null)
  const options = useMemo(() => (spec.type === 'pattern-quiz' ? patternOptionViews(spec) : []), [spec])
  if (spec.type !== 'pattern-quiz') return null
  const verdict = patternVerdict(spec, selected)
  return (
    <div className="widget-card">
      <p className="widget-q">{spec.question}</p>
      <div className="widget-grid">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`widget-tile${selected === option.id ? ' on' : ''}`}
            onClick={() => setSelected(option.id)}
          >
            <MiniChart bars={option.bars} height={150} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {verdict ? (
        <div className={`widget-feedback ${verdict.correct ? 'ok' : 'bad'}`}>
          {verdict.correct ? '✓' : '✕'} {verdict.explain}
          {!verdict.correct ? `（正确答案：${verdict.answerText}）` : ''}
        </div>
      ) : null}
    </div>
  )
}

/** calc-trainer：参数化计算训练（公式白名单，示例可复算）。 */
export function CalcTrainer({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const rows = useMemo(() => calcRows(spec), [spec])
  const [inputs, setInputs] = useState<Record<string, number> | null>(null)
  if (spec.type !== 'calc-trainer') return null
  const current = inputs ?? spec.inputs
  const live = calcFormula(spec.formula, current)
  const fields = CALC_PARAM_KEYS[spec.formula] ?? []
  return (
    <div className="widget-card">
      <p className="widget-q">{CALC_FORMULA_LABELS[spec.formula] ?? spec.formula}</p>
      <div className="widget-calc-inputs">
        {fields.map((key) => (
          <label key={key}>
            <span>{key}</span>
            <input
              type="number"
              value={current[key] ?? ''}
              onChange={(event) => {
                const value = Number(event.target.value)
                setInputs({ ...current, [key]: Number.isFinite(value) ? value : 0 })
              }}
            />
          </label>
        ))}
        <div className="widget-calc-result">
          计算结果：<b>{live === null ? '参数越界，无法计算' : live.toFixed(4)}</b>
        </div>
      </div>
      <table className="widget-table">
        <thead>
          <tr>
            <th>示例参数</th>
            <th>声明答案</th>
            <th>程序复算</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td className="mono">
                {Object.entries(row.inputs)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(' · ')}
              </td>
              <td className="mono">{row.answer}</td>
              <td className="mono">
                {row.recomputed === null ? '越界' : row.recomputed.toFixed(6)}{' '}
                <span className={row.ok ? 'ok' : 'bad'}>{row.ok ? '✓ 一致' : '✕ 不一致'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** checklist：交互清单（勾选进度只在本机）。 */
export function Checklist({ widget }: { widget: WidgetView }) {
  const spec = widget.spec
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  if (spec.type !== 'checklist') return null
  const done = spec.items.filter((item) => checked[item.text]).length
  return (
    <div className="widget-card">
      <p className="widget-q">{spec.title}</p>
      <div className="widget-progress">
        已勾选 {done} / {spec.items.length}
      </div>
      <ul className="widget-checklist">
        {spec.items.map((item) => (
          <li key={item.text}>
            <label>
              <input
                type="checkbox"
                checked={checked[item.text] ?? false}
                onChange={(event) =>
                  setChecked({ ...checked, [item.text]: event.target.checked })
                }
              />
              <span>{item.text}</span>
              {item.conceptRef ? <em>{item.conceptRef}</em> : null}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
