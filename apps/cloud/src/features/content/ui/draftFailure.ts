/**
 * 起草失败的归因（纯函数）：同一句「起草失败」下面可能是完全不同的事，
 * 教师该做什么也不同——上游配额用尽要去联系运营，参数/内容问题才该改目标或目录重提。
 */

export type DraftFailureKind = 'quota' | 'input' | 'upstream' | 'unknown'

export type DraftFailure = {
  kind: DraftFailureKind
  /** 给教师看的一句话（已经含该怎么办）。 */
  text: string
  /** 横幅上的行动按钮；null = 没有可点的动作。 */
  action: { label: string } | null
}

/** 失败原因码 → 该怎么跟教师说。 */
const INPUT_CODES: Record<string, string> = {
  material_not_understood: '所选素材还没有理解结果——请到素材页点「重跑理解」后再试',
  plan_input_missing: '课程目标缺失——补齐目标后重新提交',
  outline_draft_empty: 'Agent 没能拟出目录——补充课程目标或素材后重新提交',
  llm_schema: '模型输出不符合格式——调整课程目标或人工目录后重新提交',
  llm_bad_json: '模型输出不是合法 JSON——调整课程目标或人工目录后重新提交',
  llm_truncated: '模型输出被截断——缩短课程目标或人工目录后重新提交',
  plan_self_check_failed: '规划自检连续未通过——按下面列出的问题修掉后重新提交',
}

const QUOTA_PATTERN = /429|配额|用量上限|quota|rate.?limit/i

export function classifyDraftFailure(job: {
  errorCode: string | null
  errorMessage: string | null
} | null): DraftFailure {
  const code = job?.errorCode ?? null
  const message = job?.errorMessage ?? ''

  if (code && INPUT_CODES[code]) {
    return { kind: 'input', text: `起草失败：${INPUT_CODES[code]}`, action: { label: '去修改重提' } }
  }
  if (code === 'llm_upstream' && QUOTA_PATTERN.test(message)) {
    return {
      kind: 'quota',
      text: '起草失败：模型配额已用尽（上游返回 429），这不是课程内容的问题——请联系运营处理配额，改目录或目标也解决不了。',
      action: null,
    }
  }
  if (code === 'llm_upstream') {
    return {
      kind: 'upstream',
      text: '起草失败：模型服务暂时不可用，稍后重试即可，不用改课程目标或目录。',
      action: { label: '重新提交' },
    }
  }
  return {
    kind: 'unknown',
    text: `起草失败：${message || code || '未知原因'}。调整课程目标或人工目录后可重新提交。`,
    action: { label: '去修改重提' },
  }
}
