'use client'

import { useState } from 'react'
import type { AgentStepStatus, AgentTraceView, PlanJobView, PlanView } from '@trend-suite/contracts'

/**
 * Agent 面板（对齐原型 docs/prototype/teacher-plan.html 的 agent-rail）：
 * 「对话」讲过程、「执行」列步骤与模型调用、「产物」列方案产物。
 * 数据来自方案接口返回的真实执行轨迹（ai_runs / pipeline_jobs / 方案行），
 * 不在前端造状态——面板只是真相的视图。
 */

const STEP_TAG: Record<AgentStepStatus, { text: string; cls: string }> = {
  done: { text: '已完成', cls: 'ok' },
  running: { text: '执行中', cls: 'run' },
  waiting: { text: '等待你确认', cls: 'warn' },
  pending: { text: '待执行', cls: 'mut' },
  failed: { text: '失败', cls: 'err' },
}

function clockOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function liveOf(trace: AgentTraceView | null): { text: string; dot: string } {
  if (!trace || trace.status === 'idle') return { text: '未开始', dot: 'dot-wait' }
  if (trace.status === 'running') return { text: '正在执行', dot: 'dot-run' }
  if (trace.status === 'failed') return { text: '执行失败', dot: 'dot-err' }
  const waiting = trace.steps.find((step) => step.status === 'waiting')
  if (waiting) return { text: '等待你确认', dot: 'dot-wait' }
  return { text: '已完成', dot: 'dot-ok' }
}

export function AgentRail(props: {
  trace: AgentTraceView | null
  job: PlanJobView | null
  plan: PlanView | null
  userName: string
  busy: boolean
  /** 发送修改意见 = 打回重起草（方案状态机唯一「教师给 Agent 指令」的通道）。 */
  onSend: (text: string) => void
}) {
  const { trace, job, plan, userName, busy, onSend } = props
  const [tab, setTab] = useState<'chat' | 'run' | 'files'>('chat')
  const [text, setText] = useState('')

  const live = liveOf(trace)
  const steps = trace?.steps ?? []
  const calls = trace?.calls ?? []
  const messages = trace?.messages ?? []
  const artifacts = trace?.artifacts ?? []
  const running = job?.status === 'queued' || job?.status === 'running'
  const locked = plan?.status === 'approved'

  const totalTokens = calls.reduce((sum, call) => sum + (call.tokensOut ?? 0), 0)
  const totalLatency = calls.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0)
  const doneCount = steps.filter((step) => step.status === 'done').length

  function send() {
    const value = text.trim()
    if (!value || busy) return
    onSend(value)
    setText('')
  }

  return (
    <aside className="agent-rail" aria-label="制作 Agent">
      <div className="agent-head">
        <span className="agent-ava">制</span>
        <div className="agent-id">
          <b>制作 Agent</b>
          <small>综合 Agent · 方案起草</small>
        </div>
        <span className="agent-live">
          <i className={live.dot} />
          {live.text}
        </span>
      </div>

      <div className="agent-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'on' : ''}
          onClick={() => setTab('chat')}
        >
          对话
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'run'}
          className={tab === 'run' ? 'on' : ''}
          onClick={() => setTab('run')}
        >
          执行<span className="n">{steps.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'files'}
          className={tab === 'files' ? 'on' : ''}
          onClick={() => setTab('files')}
        >
          产物<span className="n">{artifacts.length}</span>
        </button>
      </div>

      <div className="agent-body">
        {tab === 'chat' ? (
          <div className="pane-chat">
            {messages.length === 0 ? (
              <p className="agent-empty">还没有执行记录——提交课程目标后，Agent 的每一步都会在这里留痕。</p>
            ) : null}
            {messages.map((message, index) => (
              <div key={`${message.at}-${index}`} className={message.role === 'user' ? 'msg user' : 'msg'}>
                <span className="m-av">{message.role === 'user' ? '师' : 'A'}</span>
                <div className="m-body">
                  <div className="m-meta">
                    {message.role === 'user' ? `${userName} · ` : '制作 Agent · '}
                    {clockOf(message.at)}
                  </div>
                  <div className="m-text">
                    <p>{message.text}</p>
                  </div>
                </div>
              </div>
            ))}
            {running ? (
              <div className="msg">
                <span className="m-av">A</span>
                <div className="m-body">
                  <div className="m-meta">制作 Agent · {clockOf(new Date().toISOString())}</div>
                  <div className="m-text">
                    <p className="streaming">正在第 {Math.max(job?.attempts ?? 0, 1)} 次尝试起草…</p>
                  </div>
                </div>
              </div>
            ) : null}

            {steps.length > 0 ? (
              <div className="planw">
                <div className="ph">
                  执行计划 <span className="n">{doneCount}/{steps.length}</span>
                </div>
                {steps.map((step) => (
                  <div
                    key={step.key}
                    className={step.status === 'done' ? 'pw-item done' : step.status === 'running' ? 'pw-item doing' : 'pw-item'}
                  >
                    <span className="tick">{step.status === 'done' ? '✓' : ''}</span>
                    <span>{step.label}</span>
                    <span className="pn">{step.metrics[0] ?? ''}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'run' ? (
          <div className="pane-run">
            <div className="run-head">
              <div className="rh">
                <span className="agent-ava sm">制</span>
                综合 Agent · 方案起草
                <span className="st">
                  <span className={`tag ${live.dot === 'dot-ok' ? 'ok' : live.dot === 'dot-run' ? 'run' : live.dot === 'dot-err' ? 'err' : 'warn'}`}>
                    {live.text}
                  </span>
                </span>
              </div>
              <div className="rm">
                <span>{calls.length} calls</span>
                <span>{totalTokens.toLocaleString('zh-CN')} tokens</span>
                <span>{(totalLatency / 1000).toFixed(1)}s</span>
              </div>
            </div>
            {steps.map((step) => (
              <div key={step.key} className="run-node">
                <div className="nh">
                  <b>{step.label}</b>
                  <span className="st">
                    <span className={`tag ${STEP_TAG[step.status].cls}`}>{STEP_TAG[step.status].text}</span>
                  </span>
                </div>
                {step.metrics.length > 0 ? (
                  <div className="nm">
                    {step.metrics.map((metric) => (
                      <span key={metric}>{metric}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {calls.length > 0 ? (
              <div className="tool-group">
                <div className="tg-h">{calls.length} 次模型调用</div>
                {calls.map((call) => (
                  <details key={call.id} className="tool">
                    <summary>
                      <span className="tn">{call.label}</span>
                      <span className="ta">{call.model}</span>
                      <span className="ts">
                        {call.status === 'failed' ? '失败' : `${((call.latencyMs ?? 0) / 1000).toFixed(1)}s`}
                      </span>
                    </summary>
                    <div className="tbody">
                      {`status=${call.status} tokens_in=${call.tokensIn ?? '-'} tokens_out=${call.tokensOut ?? '-'} latency=${call.latencyMs ?? '-'}ms`}
                    </div>
                  </details>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'files' ? (
          <div className="pane-files">
            <div className="filetree">
              <div className="fh">
                workspace / 课程方案<span className="n">{artifacts.length} files</span>
              </div>
              {artifacts.map((artifact) => (
                <div key={artifact.path} className={artifact.path.endsWith('/') ? 'file folder' : 'file'}>
                  <span className="fn">{artifact.path}</span>
                  <span className="fs">{artifact.note}</span>
                </div>
              ))}
            </div>
            {plan ? (
              <div className="file-preview">
                {`# 课程制作方案 v${plan.version}（${plan.status === 'approved' ? '基准版' : 'draft'}）\n`}
                {`chapters: ${plan.skeleton.nodes.length}\n`}
                {`concepts: ${plan.conceptMap.concepts.length}\n`}
                {`glossary: ${plan.glossary.items.length}\n`}
                {`lessons: ${plan.sectionPlan.lessons.length}\n`}
                {`violations: ${plan.violations.length}\n`}
                {`locked: ${plan.status === 'approved'}`}
              </div>
            ) : (
              <p className="note">产物在 Agent 完成起草后写入；当前尚未产出方案文件。</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="agent-foot">
        <div className="quick">
          <button
            type="button"
            onClick={() => setText('依据当前素材重新梳理一版大纲，保留已有章节编号。')}
            disabled={locked}
          >
            重新梳理
          </button>
          <button
            type="button"
            onClick={() => setText('请优化当前大纲：指出过粗或过细的章节，并给出调整建议。')}
            disabled={locked}
          >
            让 Agent 改
          </button>
        </div>
        <div className="composer">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              locked
                ? '方案已锁定为基准版，无法再下指令'
                : '输入修改意见，发送后 Agent 按意见重新起草（打回）'
            }
            disabled={locked || !plan}
          />
          <div className="cr">
            <span className="grow" />
            <span className="kbd">⌘↵</span>
            <button
              type="button"
              className="send"
              title="发送"
              onClick={send}
              disabled={locked || !plan || !text.trim() || busy}
            >
              ↑
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
