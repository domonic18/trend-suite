import { stripOutlineNumbering } from '@trend-suite/contracts'

/**
 * 标题归一：去编号前缀、去空白与标点、大小写归一——
 * 「1. 趋势是什么」与「趋势是什么」算同一个标题。
 *
 * 单点定义：自检（重复 / 空话）与分节计划的标题回挂共用这一份口径。
 */
export function normalizeLessonTitle(title: string): string {
  return stripOutlineNumbering(title)
    .replace(/[\s、，,。.：:；;！!？?（）()「」《》"'“”‘’·\-—_/\\]/g, '')
    .toLowerCase()
}
