'use client'

import type { AgentQuestionOption } from '@trend-suite/contracts'

/**
 * AskQuestion 确认卡（原型 .ask）：问题 + 2~4 选项 + 一句说明，点选即回答。
 * locked（已回答或正在提交）后选项不可再点；选中项高亮打勾。
 */
export function QuestionCard({
  question,
  options,
  locked,
  selectedIndex,
  answering,
  onAnswer,
}: {
  question: string
  options: AgentQuestionOption[]
  locked: boolean
  selectedIndex: number | null
  answering: boolean
  onAnswer: (optionIndex: number) => void
}) {
  return (
    <div className={`ask${locked ? ' locked' : ''}`}>
      <div className="qh">需要你确认</div>
      <div className="qt">{question}</div>
      <div className="opts">
        {options.map((option, index) => (
          <button
            key={index}
            type="button"
            className={selectedIndex === index ? 'opt on' : 'opt'}
            disabled={locked || answering}
            onClick={() => onAnswer(index)}
          >
            <span className="ot">
              <b>{option.label}</b>
              {option.description ? <small>{option.description}</small> : null}
            </span>
            <span className="ok">✓</span>
          </button>
        ))}
      </div>
    </div>
  )
}
