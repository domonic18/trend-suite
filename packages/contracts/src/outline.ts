/**
 * 目录先验格式：三级编号（篇 / 章 / 课时），章号全书连续、课时章内重排
 * ——前后端唯一真相源。
 *
 * 服务端用它把教师提交的原文解析成骨架下界（目录外不建章，arch/05 §5）；
 * 教师端用它本地逐行提示与一键规整，避免「前端一套正则、后端另一套」的漂移。
 */

export type OutlineLevel = 1 | 2 | 3

export type OutlineNode = {
  id: string
  title: string
  level: OutlineLevel
  parentId: string | null
}

/** 解析问题：行号用于教师端逐行标红。 */
export type OutlineIssue = {
  /** 原文行号（1 起，含空行位置）。 */
  line: number
  /** 非空行序号（1 起）——历史错误文案的口径。 */
  index: number
  text: string
  message: string
}

export type OutlineParseResult = {
  nodes: OutlineNode[]
  issues: OutlineIssue[]
}

/** 目录最多多少行（防止超长目录拖垮起草）。 */
export const MAX_OUTLINE_NODES = 200

const LEVEL_PATTERNS: { level: OutlineLevel; pattern: RegExp }[] = [
  { level: 1, pattern: /^(第\s*[一二三四五六七八九十百零\d]+\s*篇|Part\s*\d+[.:：\s])/i },
  {
    level: 2,
    pattern: /^(第\s*[一二三四五六七八九十百零\d]+\s*章|[一二三四五六七八九十百零]+\s*、)/,
  },
  { level: 3, pattern: /^(\d{1,3})\s*[.、)）:：]\s*\S/ },
]

/** 识别一行的层级；认不出返回 null。 */
export function matchOutlineLevel(line: string): OutlineLevel | null {
  const hit = LEVEL_PATTERNS.find(({ pattern }) => pattern.test(line))
  return hit ? hit.level : null
}

/** 目录原文 → 目录树 + 逐行问题（不抛错，问题由调用方决定怎么呈现）。 */
export function parseOutlineText(text: string): OutlineParseResult {
  const nodes: OutlineNode[] = []
  const issues: OutlineIssue[] = []
  const stack: { level: OutlineLevel; id: string }[] = []
  let index = 0

  text.split(/\r?\n/).forEach((raw, rawIndex) => {
    const line = raw.trim()
    if (line.length === 0) return
    index += 1
    const level = matchOutlineLevel(line)
    if (level === null) {
      issues.push({
        line: rawIndex + 1,
        index,
        text: line,
        message: `第 ${index} 行「${line.slice(0, 40)}」请用「第X篇 / 第X章 / 1.」三级编号`,
      })
      return
    }
    const id = `n${nodes.length + 1}`
    const parent = [...stack].reverse().find((entry) => entry.level < level)
    if (parent) {
      while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop()
    }
    stack.push({ level, id })
    nodes.push({ id, title: line.slice(0, 200), level, parentId: parent?.id ?? null })
  })

  return { nodes, issues }
}

const CN_DIGITS = '一二三四五六七八九十'

/** 阿拉伯数字 → 中文数字（限 99，用于篇/章编号）。 */
export function numberToCn(value: number): string {
  if (value < 0 || value > 99) return String(value)
  if (value < 10) return CN_DIGITS[value - 1]!
  const tens = Math.floor(value / 10)
  const ones = value % 10
  return `${CN_DIGITS[tens - 1]!}十${ones > 0 ? CN_DIGITS[ones - 1]! : ''}`
}

/** 中文数字 → 阿拉伯数字（限 99，够用于目录编号）。 */
function cnToNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  if (text === '十') return 10
  if (text.length === 1) {
    const at = CN_DIGITS.indexOf(text)
    return at >= 0 ? at + 1 : null
  }
  if (text.length === 2 && text[1] === '十') {
    const head = CN_DIGITS.indexOf(text[0]!)
    return head >= 0 ? (head + 1) * 10 : null
  }
  if (text.length === 3 && text[1] === '十') {
    const head = CN_DIGITS.indexOf(text[0]!)
    const tail = CN_DIGITS.indexOf(text[2]!)
    return head >= 0 && tail >= 0 ? (head + 1) * 10 + tail + 1 : null
  }
  return null
}

/**
 * 一键规整：把常见写法（第一部分 / 一. / 1 xxx / （1）xxx / 无编号行）
 * 改写成解析器认得的编号形式；**尽量保留原文的编号文字与标题**。
 * 认不出层级的行按上文层级顺推一级补编号——教师提交前会在文本框里复核。
 *
 * 编号口径与 `renderOutlineText` 一致：篇/章用中文数字，**章号全书连续**，
 * 课时号在章内重排。教师原文里已有的号被沿用（补号时接着往下排），
 * 不换成另一套号。
 */
export function normalizeOutlineText(text: string): string {
  const out: string[] = []
  let prevLevel: OutlineLevel | null = null
  let partNo = 0
  let chapterNo = 0
  let lessonNo = 0

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) {
      out.push(raw)
      continue
    }
    // 已合规：原样保留
    const level = matchOutlineLevel(line)
    if (level !== null) {
      out.push(line)
      prevLevel = level
      if (level === 1) {
        partNo = leadingUnitNumber(line, '篇') ?? partNo + 1
        lessonNo = 0
      } else if (level === 2) {
        chapterNo = leadingUnitNumber(line, '章') ?? chapterNo + 1
        lessonNo = 0
      } else {
        lessonNo = leadingLessonNumber(line) ?? lessonNo + 1
      }
      continue
    }

    const rewritten = rewriteLoose(line)
    if (rewritten) {
      out.push(rewritten.text)
      prevLevel = rewritten.level
      if (rewritten.level === 1) {
        partNo = leadingUnitNumber(rewritten.text, '篇') ?? partNo + 1
        lessonNo = 0
      } else if (rewritten.level === 2) {
        chapterNo = leadingUnitNumber(rewritten.text, '章') ?? chapterNo + 1
        lessonNo = 0
      } else {
        lessonNo = leadingLessonNumber(rewritten.text) ?? lessonNo + 1
      }
      continue
    }

    // 认不出层级：按上文顺推一级补最小编号
    const inferred: OutlineLevel = prevLevel === null ? 1 : prevLevel >= 3 ? 3 : ((prevLevel + 1) as OutlineLevel)
    if (inferred === 1) {
      partNo += 1
      lessonNo = 0
      out.push(`第${numberToCn(partNo)}篇 ${line}`)
    } else if (inferred === 2) {
      chapterNo += 1
      lessonNo = 0
      out.push(`第${numberToCn(chapterNo)}章 ${line}`)
    } else {
      lessonNo += 1
      out.push(`${lessonNo}. ${line}`)
    }
    prevLevel = inferred
  }

  return out.join('\n')
}

/** 行首「第X篇 / 第X章」的号；取不到返回 null。 */
function leadingUnitNumber(line: string, unit: string): number | null {
  const match = new RegExp(`^第\\s*([一二三四五六七八九十百零\\d]+)\\s*${unit}`).exec(line)
  return match ? cnToNumber(match[1]!) : null
}

/** 行首「1.」的号；取不到返回 null。 */
function leadingLessonNumber(line: string): number | null {
  const match = /^(\d{1,3})\s*[.、)）:：]/.exec(line)
  return match ? Number(match[1]) : null
}

/** 宽松模式识别：返回改写后的文本与层级；认不出返回 null。 */
function rewriteLoose(line: string): { text: string; level: OutlineLevel } | null {
  // 第一部分 / 第一编 / 第一卷 → 第一篇
  const part = /^第\s*([一二三四五六七八九十百零\d]+)\s*(分部|部分|部|编|卷)\s*[:：.、]?\s*(.+)$/.exec(line)
  if (part) {
    return { text: `第${part[1]}篇 ${part[3]}`, level: 1 }
  }
  // 一. 标题 / 一, 标题 → 一、标题
  const cn = /^([一二三四五六七八九十百零]+)\s*[.．,，]\s*(.+)$/.exec(line)
  if (cn) {
    return { text: `${cn[1]}、${cn[2]}`, level: 2 }
  }
  // （1）标题 → 1. 标题
  const paren = /^[（(]\s*(\d{1,3})\s*[)）]\s*(.+)$/.exec(line)
  if (paren) {
    return { text: `${paren[1]}. ${paren[2]}`, level: 3 }
  }
  // 1.2 标题 / 1 标题 / 1: 标题 → 1.2. 标题
  const num = /^(\d{1,3}(?:\.\d{1,3})*)\s*[:：]?\s+(.+)$/.exec(line)
  if (num) {
    return { text: `${num[1]}. ${num[2]}`, level: 3 }
  }
  // 第三章：标题 已合规（走不到这里），「第三讲 标题」→ 第三章 标题
  const lecture = /^第\s*([一二三四五六七八九十百零\d]+)\s*讲\s*(.+)$/.exec(line)
  if (lecture) {
    return { text: `第${lecture[1]}章 ${lecture[2]}`, level: 2 }
  }
  // 裸中文数字行（无标点）：一、标题 的省略写法
  const bareCn = /^([一二三四五六七八九十百零]+)\s+(.+)$/.exec(line)
  if (bareCn) {
    const no = cnToNumber(bareCn[1]!)
    if (no !== null) {
      return { text: `${bareCn[1]}、${bareCn[2]}`, level: 2 }
    }
  }
  return null
}

/** 标题里可能自带的编号前缀（第X章 / 一、 / 1. / （1））。 */
const NUMBERING_PREFIX =
  /^(?:第\s*[一二三四五六七八九十百零\d]+\s*[篇章节讲部卷]|[一二三四五六七八九十百零]+\s*[、．.]|[（(]\s*\d{1,3}\s*[)）]|\d{1,3}(?:\.\d{1,3})*\s*[.、)）:：])\s*/

/** 去掉标题自带的编号前缀，只留标题文字。 */
export function stripOutlineNumbering(title: string): string {
  return title.replace(NUMBERING_PREFIX, '').trim()
}

/** 目录条目（层级 + 标题）——Agent 代拟目录的最小结构。 */
export type OutlineSection = { level: OutlineLevel; title: string }

/**
 * 由层级+标题生成规范目录文本（第一篇 / 第一章 / 1.）。
 * **章号全书连续**（第一篇下是第一章…，第二篇下接着往下排），
 * 课时号在章内重新计数。
 */
export function renderOutlineText(sections: OutlineSection[]): string {
  const lines: string[] = []
  let partNo = 0
  let chapterNo = 0
  let lessonNo = 0
  for (const section of sections) {
    const title = stripOutlineNumbering(section.title)
    if (title.length === 0) continue
    if (section.level === 1) {
      partNo += 1
      lessonNo = 0
      lines.push(`第${numberToCn(partNo)}篇 ${title}`)
    } else if (section.level === 2) {
      chapterNo += 1
      lessonNo = 0
      lines.push(`第${numberToCn(chapterNo)}章 ${title}`)
    } else {
      lessonNo += 1
      lines.push(`${lessonNo}. ${title}`)
    }
  }
  return lines.join('\n')
}

/**
 * 结构化目录 → 规范文本 + 目录树。
 * 树由文本回解析得到，保证「文本 ↔ 树」永远一致（同一套编号口径）。
 */
export function buildOutlineFromSections(sections: OutlineSection[]): {
  text: string
  nodes: OutlineNode[]
} {
  const text = renderOutlineText(sections)
  return { text, nodes: parseOutlineText(text).nodes }
}
