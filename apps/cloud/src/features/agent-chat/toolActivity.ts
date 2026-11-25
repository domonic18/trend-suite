import type { AgentToolEventView } from '@trend-suite/contracts'

/**
 * 工具行的人类可读摘要（arch/08 §6，对齐 SasanImmersive tool-activity）：
 * 工具名翻译成中文动作、连续读操作聚合、一行摘要 + 可展开明细——
 * 对话流不再出现裸工具名。
 */

/** 读类工具：连续出现时聚合为一行「查阅课程与制作资料 · N 次」。 */
const READ_TOOLS = new Set(['get_plan', 'get_materials', 'get_production_status'])

const ACTIONS: Record<string, string> = {
  get_plan: '读取当前方案',
  get_materials: '查看素材清单',
  get_production_status: '读取制作进度',
  draft_plan: '提交方案起草',
  revise_plan: '打回重新起草',
  apply_tweak: '结构化微调方案',
  ask_question: '收集教师意见',
  todo_write: '更新任务清单',
  stop_production: '停止制作',
  resume_production: '继续制作',
  retry_section: '重试挂起的节',
}

export function toolLabel(tool: string): string {
  return ACTIONS[tool] ?? '执行工具操作'
}

export function isReadTool(tool: string): boolean {
  return READ_TOOLS.has(tool)
}

/** 分组：连续的读类工具合并为一组，其余按同名连续合并。 */
export type ToolGroup = { kind: 'reads' | 'same'; tool: string; calls: AgentToolEventView[] }

export function groupTools(tools: AgentToolEventView[]): ToolGroup[] {
  const groups: ToolGroup[] = []
  for (const call of tools) {
    const last = groups[groups.length - 1]
    if (isReadTool(call.name) && last?.kind === 'reads') {
      last.calls.push(call)
      continue
    }
    if (last && last.kind === 'same' && last.tool === call.name) {
      last.calls.push(call)
      continue
    }
    groups.push({
      kind: isReadTool(call.name) ? 'reads' : 'same',
      tool: call.name,
      calls: [call],
    })
  }
  return groups
}

/** 一组调用的一行摘要：label（已/正在 + 中文动作）+ detail（次数/失败数/耗时）。 */
export function describeGroup(group: ToolGroup): { label: string; detail: string } {
  const { calls } = group
  const failed = calls.filter((call) => call.status === 'err').length
  const totalMs = calls.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0)
  const latency = totalMs > 0 ? `${(totalMs / 1000).toFixed(1)}s` : ''
  let label: string
  let detail = ''
  if (group.kind === 'reads') {
    label = '查阅课程与制作资料'
    detail = calls.length > 1 ? `${calls.length} 次` : ''
  } else {
    label = `已${toolLabel(group.tool)}`
    if (calls.length > 1) detail = `${calls.length} 次`
    const args = calls[0]?.argsSummary
    if (calls.length === 1 && args) detail = args
  }
  if (failed > 0) {
    label = label.replace(/^已/, '')
    detail = [detail, `${failed} 次未通过`].filter(Boolean).join(' · ')
  }
  return { label, detail: [detail, latency].filter(Boolean).join(' · ') }
}
