'use client'

import type { ProductionEventView, ProductionSectionRow, ProductionStopView } from '@trend-suite/contracts'

/**
 * 制作 Agent 对话流（教师端需求 T21）：把九步引擎的**事实**排成对话流。
 *
 * 只说发生了什么、花了多少（步状态、模型、耗时、token），不替模型复述措辞——
 * 模型说了什么在教材正文里，这里回答「现在做到哪、花了多少」。
 * 停止卡单独成块：已停在哪一步、成果保留、改完可继续。
 */

function clockOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

type Node =
  | { kind: 'step'; event: ProductionEventView }
  | { kind: 'tools'; events: ProductionEventView[] }
  | { kind: 'stop'; event: ProductionEventView }

/** 工具调用归到它前面那条步消息下（原型：一条步消息带一个 tool-group）。 */
function toNodes(events: ProductionEventView[]): Node[] {
  const nodes: Node[] = []
  let pending: ProductionEventView[] = []
  const flush = () => {
    if (pending.length > 0) {
      nodes.push({ kind: 'tools', events: pending })
      pending = []
    }
  }
  for (const event of events) {
    if (event.kind === 'tool') {
      pending.push(event)
      continue
    }
    flush()
    nodes.push(event.kind === 'stop' ? { kind: 'stop', event } : { kind: 'step', event })
  }
  flush()
  return nodes
}

function stepStatusText(status: string | null): string | null {
  if (status === 'running') return '进行中'
  if (status === 'done') return '已完成'
  if (status === 'failed') return '失败，回灌重写'
  if (status === 'pending_manual') return '挂起待人工'
  return null
}

export function AgentStream(props: {
  events: ProductionEventView[]
  stopped: boolean
  stop: ProductionStopView | null
  /** 当前节（九步清单的事实来源）。 */
  current: ProductionSectionRow | null
  running: boolean
  busy: boolean
  onResume: () => void
  onStop: () => void
  canControl: boolean
}) {
  const { events, stopped, stop, current, running, busy, onResume, onStop, canControl } = props
  const nodes = toNodes(events)
  const currentStep = current?.tasks.find((task) => task.status === 'running') ?? null

  const toolEvents = events.filter((event) => event.kind === 'tool')
  const totalTokens = toolEvents.reduce((sum, event) => sum + (event.tokensOut ?? 0), 0)
  const totalLatency = toolEvents.reduce((sum, event) => sum + (event.latencyMs ?? 0), 0)

  return (
    <aside className="agent-rail" aria-label="制作 Agent">
      <div className="agent-head">
        <span className="agent-ava">制</span>
        <div className="agent-id">
          <b>制作 Agent</b>
          <small>九步引擎 · 逐节生产</small>
        </div>
        <span className="agent-live">
          <i className={stopped ? 'dot-wait' : running ? 'dot-run' : 'dot-ok'} />
          {stopped ? '已停止' : running ? '正在执行' : '空闲'}
        </span>
      </div>

      <div className="agent-body">
        <div className="pane-chat">
          {nodes.length === 0 ? (
            <p className="agent-empty">
              还没有制作记录——批准课程方案后，Agent 每一步都会在这里留痕。
            </p>
          ) : null}

          {nodes.map((node, index) => {
            if (node.kind === 'tools') {
              return (
                <div className="tool-group" key={`tools-${index}`}>
                  <div className="tg-h">
                    {node.events.length} 次模型调用 · {totalTokens.toLocaleString('zh-CN')} tokens ·{' '}
                    {(totalLatency / 1000).toFixed(1)}s
                  </div>
                  {node.events.map((event) => (
                    <details className="tool" key={event.id}>
                      <summary>
                        <span className="tn">{event.model ?? '模型调用'}</span>
                        <span className="ta">{event.stepLabel ?? ''}</span>
                        <span className="ts">
                          {event.latencyMs ? `${(event.latencyMs / 1000).toFixed(1)}s` : '—'}
                        </span>
                      </summary>
                      <div className="tbody">
                        {`status=${event.status ?? '-'} tokens_in=${event.tokensIn ?? '-'} tokens_out=${
                          event.tokensOut ?? '-'
                        } latency=${event.latencyMs ?? '-'}ms`}
                      </div>
                    </details>
                  ))}
                </div>
              )
            }
            if (node.kind === 'stop') {
              return (
                <div className="interrupt" key={node.event.id}>
                  <div className="ih">
                    <span className="tag gray">{node.event.title}</span>
                    {node.event.detail ?? ''}
                  </div>
                  <div className="it">{clockOf(node.event.at)}</div>
                </div>
              )
            }
            const statusText = stepStatusText(node.event.status)
            return (
              <div className="msg" key={node.event.id}>
                <span className="m-av">A</span>
                <div className="m-body">
                  <div className="m-meta">
                    制作 Agent · {clockOf(node.event.at)}
                    {node.event.sectionTitle ? ` · ${node.event.sectionTitle}` : ''}
                  </div>
                  <div className="m-text">
                    <p className={node.event.status === 'running' ? 'streaming' : undefined}>
                      {node.event.title}
                      {statusText ? ` · ${statusText}` : ''}
                    </p>
                    {node.event.detail ? <p className="note">{node.event.detail}</p> : null}
                  </div>
                </div>
              </div>
            )
          })}

          {current && current.tasks.length > 0 ? (
            <div className="planw">
              <div className="ph">
                {current.title} <span className="n">{current.products}/9</span>
              </div>
              {current.tasks.map((task) => (
                <div
                  key={task.step}
                  className={
                    task.status === 'done'
                      ? 'pw-item done'
                      : task.status === 'running'
                        ? 'pw-item doing'
                        : 'pw-item'
                  }
                >
                  <span className="tick">{task.status === 'done' ? '✓' : ''}</span>
                  <span>{task.label}</span>
                  <span className="pn">
                    {task.status === 'running'
                      ? 'now'
                      : task.status === 'pending_manual'
                        ? '待人工'
                        : task.status === 'failed'
                          ? '失败'
                          : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {stopped && stop ? (
            <div className="interrupt err">
              <div className="ih">
                <span className="tag failed">已停止</span>
                {stop.sectionTitle ? `${stop.sectionTitle} · ` : ''}
                {stop.step ? `第 ${stop.step} 步「${stop.stepLabel ?? ''}」` : '尚未开跑'}
              </div>
              <div className="it">我在当前步骤边界安全停下了</div>
              <p style={{ margin: '6px 0 0' }}>
                已完成的步成果保留（不会重跑），回灌预算也保留；改完内容随时可以继续。
              </p>
              <div className="ia" style={{ marginTop: 9 }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !canControl}
                  onClick={onResume}
                >
                  改完继续制作
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="agent-foot">
        <div className="quick">
          {running && !stopped ? (
            <button type="button" disabled={busy || !canControl} onClick={onStop}>
              停止制作
            </button>
          ) : stopped ? (
            <button type="button" disabled={busy || !canControl} onClick={onResume}>
              继续制作
            </button>
          ) : null}
          {currentStep ? <span className="note">正在第 {currentStep.step} 步「{currentStep.label}」</span> : null}
        </div>
      </div>
    </aside>
  )
}
