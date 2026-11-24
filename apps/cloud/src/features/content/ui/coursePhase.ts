/**
 * 课程阶段模型：这门课到哪一步了、下一步该干什么。
 *
 * 全部是纯函数（无 React、无网络），因为工作台的可懂性就压在这份口径上：
 * 组件只渲染，判断全在这里，教师端与服务端讲同一套话。
 */

export type CoursePhaseKey = 'material' | 'plan' | 'production' | 'readiness'

/** 阶段状态：待办 / 进行中 / 已完成 / 被卡住 / 后续迭代。 */
export type PhaseState = 'todo' | 'active' | 'done' | 'blocked' | 'soon'

export type CoursePhaseInput = {
  assetCount: number
  readyAssetCount: number
  planStatus: 'none' | 'draft' | 'approved'
  planVersion: number | null
  chapterCount: number
  lessonCount: number
  sectionCount: number
  doneSectionCount: number
}

export type CoursePhase = {
  key: CoursePhaseKey
  label: string
  title: string
  desc: string
  state: PhaseState
  hint: string
}

export type NextAction = {
  phase: CoursePhaseKey
  label: string
  hint: string
}

export const PHASE_LABELS: Record<CoursePhaseKey, string> = {
  material: '素材与转写',
  plan: '制作方案',
  production: '九步生产',
  readiness: '发布就绪度',
}

/** 从路由反推当前阶段（深链保持可用；课程根路径会立即重定向，不标阶段）。 */
export function phaseOfPath(pathname: string): CoursePhaseKey | null {
  if (pathname.endsWith('/plan')) return 'plan'
  if (pathname.includes('/production')) return 'production'
  if (/\/courses\/[^/]+$/.test(pathname)) return null
  return 'material'
}

/**
 * 阶段状态与提示（素材 / 方案 / 生产三段）。
 *
 * 阶段是有先后的：素材没就绪就没方案，方案没批准就没生产——
 * 下游阶段在上游没到位时一律 todo，不显示成「进行中」骗人。
 * 素材阶段没有独立页面（收口在素材库），只参与状态推导与课程卡提示。
 */
function materialPhase(input: CoursePhaseInput): CoursePhase {
  let state: PhaseState
  let hint: string
  if (input.assetCount === 0) {
    state = 'todo'
    hint = '还没有素材——上传课程视频开始'
  } else if (input.readyAssetCount < input.assetCount) {
    state = 'active'
    hint = `转写与理解进行中（${input.readyAssetCount}/${input.assetCount} 个素材就绪）`
  } else {
    state = 'done'
    hint = `${input.assetCount} 个素材已转写并理解完毕`
  }
  return {
    key: 'material',
    label: PHASE_LABELS.material,
    title: '素材与转写',
    desc: '把课程录像拖进来；转写与理解完成后，Agent 才能依据素材起草方案。',
    state,
    hint,
  }
}

function planPhase(input: CoursePhaseInput, materialReady: boolean): CoursePhase {
  let state: PhaseState
  let hint: string
  if (input.planStatus === 'approved') {
    state = 'done'
    hint = `方案 v${input.planVersion ?? 1} 已批准`
  } else if (input.planStatus === 'draft') {
    state = 'active'
    hint = `方案 v${input.planVersion ?? 1} 已起草，待你审阅批准`
  } else {
    state = materialReady ? 'active' : 'todo'
    hint = materialReady
      ? '还没有方案——提交课程目标，Agent 起草目录与课时'
      : '素材就绪后即可起草方案'
  }
  return {
    key: 'plan',
    label: PHASE_LABELS.plan,
    title: '制作方案',
    desc: 'Agent 依据素材起草课程骨架、概念图谱与分节计划；审阅后批准或微调。',
    state,
    hint,
  }
}

function productionPhase(input: CoursePhaseInput, planApproved: boolean): CoursePhase {
  let state: PhaseState
  let hint: string
  if (!planApproved) {
    state = 'todo'
    hint = '方案批准后开始九步生产'
  } else if (input.sectionCount === 0) {
    state = 'active'
    hint = '正在起跑第一节'
  } else if (input.doneSectionCount < input.sectionCount) {
    state = 'active'
    hint = `生产中（${input.doneSectionCount}/${input.sectionCount} 节已完成）`
  } else {
    state = 'done'
    hint = `${input.sectionCount} 节全部完成`
  }
  return {
    key: 'production',
    label: PHASE_LABELS.production,
    title: '九步生产',
    desc: '批准方案后自动逐节起跑；顺序被强制、崩溃可续跑、失败可回灌或挂起。',
    state,
    hint,
  }
}

/**
 * 下一步：任何时刻只有一个答案。
 *
 * 教师最常问的是「我现在该干什么」，所以这里不做多选——
 * 按阶段先后取第一个没做完的阶段。
 */
export function nextActionOf(input: CoursePhaseInput): NextAction {
  const material = materialPhase(input)
  const plan = planPhase(input, material.state === 'done')
  const production = productionPhase(input, plan.state === 'done')

  if (material.state !== 'done') {
    return {
      phase: 'material',
      label: material.state === 'todo' ? '去素材库上传' : '等待素材就绪',
      hint: material.hint,
    }
  }
  if (plan.state !== 'done') {
    return {
      phase: 'plan',
      label: input.planStatus === 'draft' ? '审阅并批准方案' : '起草课程方案',
      hint: plan.hint,
    }
  }
  if (production.state !== 'done') {
    return {
      phase: 'production',
      label: input.sectionCount === 0 ? '开始九步生产' : '查看生产进度',
      hint: production.hint,
    }
  }
  return {
    phase: 'readiness',
    label: '准备交付运营',
    hint: '全课已生产完成；发布就绪度判定在后续迭代开放。',
  }
}

/** 整体进度（0～1）：三段各占三分之一，段内按素材/节数细算。 */
export function progressOf(input: CoursePhaseInput): number {
  let score = 0
  if (input.assetCount > 0) {
    score += Math.min(1, input.readyAssetCount / input.assetCount)
  }
  if (input.planStatus === 'approved') score += 1
  else if (input.planStatus === 'draft') score += 0.5
  if (input.sectionCount > 0) {
    score += Math.min(1, input.doneSectionCount / input.sectionCount)
  }
  return Math.max(0, Math.min(1, score / 3))
}

export type StatusTag = { text: string; tone: 'gray' | 'run' | 'warn' | 'ok' }

/** 课程卡上的状态标：一眼看出这门课卡在哪。 */
export function courseStatusTagOf(input: CoursePhaseInput): StatusTag {
  if (input.assetCount === 0) return { text: '待上传素材', tone: 'gray' }
  if (input.readyAssetCount < input.assetCount) return { text: '素材处理中', tone: 'run' }
  if (input.planStatus === 'none') return { text: '待起草方案', tone: 'gray' }
  if (input.planStatus === 'draft') return { text: '方案待审阅', tone: 'warn' }
  if (input.sectionCount === 0) return { text: '待生产', tone: 'run' }
  if (input.doneSectionCount < input.sectionCount) return { text: '生产中', tone: 'run' }
  return { text: '生产完成', tone: 'ok' }
}

/** 课程卡上的一行说明：章·节数与素材数，教师一眼看到规模。 */
export function courseScaleOf(input: CoursePhaseInput): string {
  const parts: string[] = []
  if (input.chapterCount > 0 || input.lessonCount > 0) {
    parts.push(`${input.chapterCount} 章 · ${input.lessonCount} 课时`)
  }
  if (input.assetCount > 0) {
    parts.push(`${input.assetCount} 个素材`)
  }
  if (parts.length === 0) return '还没有素材与目录'
  return parts.join(' · ')
}
