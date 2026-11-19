import 'server-only'
import type { WidgetIssue } from '@trend-suite/contracts'

/**
 * 拒绝原因串成回灌文本（arch/05 §7）：模型重写与 pending_manual 溯源共用这一份。
 * last_error 只存 500 字——课件类问题按「总数 + 前 3 条」截断，其余在断言面板里看全。
 */

export function formatIssues(
  head: string,
  issues: { code: string; line: number | null; message: string; suggestion?: string | undefined }[],
): string {
  const detail = issues
    .map((issue) => {
      const at = issue.line ? `@L${issue.line}` : ''
      const tip = issue.suggestion ? `；最接近的已收录术语：${issue.suggestion}` : ''
      return `${issue.code}${at}（${issue.message}${tip}）`
    })
    .join('；')
  return `${head}：${detail}`
}

/** 课件复检拒绝：总数 + 前 3 条（每条带断言名与可据以改写的依据）。 */
export function formatWidgetIssues(head: string, issues: WidgetIssue[]): string {
  const head3 = issues
    .slice(0, 3)
    .map((issue, index) => {
      const name = issue.assertion ? `（${issue.assertion}）` : ''
      return `${index + 1}) ${issue.code}${name} ${issue.message}`
    })
    .join('；')
  const rest = issues.length > 3 ? `；其余 ${issues.length - 3} 条见断言面板` : ''
  return `${head}：共 ${issues.length} 条不通过；${head3}${rest}`
}
