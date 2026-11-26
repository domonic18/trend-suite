import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

/**
 * 双主题 token 同步守卫（评审改进）：浅色族（base.css :root）的每个
 * 语义色 token 必须在深色族（console-tokens.css :root[data-wb-theme='dark']）
 * 有覆写，或在本测试显式豁免——新增颜色漏写深色值 = 深色主题下不可见
 * /错色（「骨架不可见」事故的同族），CI 直接挡下。
 */

const root = process.cwd() // node --test 从 apps/cloud 起
const baseCss = readFileSync(join(root, 'src/app/styles/base.css'), 'utf8')
const darkCss = readFileSync(join(root, 'src/app/console-tokens.css'), 'utf8')

function tokensOf(css: string, selector: string): Set<string> {
  const idx = css.indexOf(selector)
  assert.notEqual(idx, -1, `${selector} 段缺失`)
  const body = css.slice(idx, css.indexOf('}', idx))
  return new Set(
    [...body.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1] as string),
  )
}

const light = tokensOf(baseCss, ':root')
const dark = tokensOf(darkCss, ":root[data-wb-theme='dark']")

/** 豁免清单：浅色专用（深色沿用浅色值即可）——写字段与理由。 */
const DARK_EXEMPT = new Set<string>([
  '--p-bg', '--p-line', // 深色族有覆写，此行只是防误报的占位说明，实际都覆写了
])

test('浅色族语义色 token 在深色族都有覆写（或显式豁免）', () => {
  const missing: string[] = []
  for (const name of light) {
    if (name.startsWith('--k-') || name.startsWith('--p-font') || name.startsWith('--r-') || name.startsWith('--shell-')) continue // 非颜色 / 度量 token 不要求
    if (DARK_EXEMPT.has(name)) continue
    if (!dark.has(name)) missing.push(name)
  }
  assert.deepEqual(missing, [], `以下 token 缺深色覆写（console-tokens.css 补上或加入豁免）：${missing.join(', ')}`)
})

test('深色族没有覆写浅色族不存在的 token（防拼写漂移）', () => {
  const orphan = [...dark].filter((name) => !light.has(name))
  assert.deepEqual(
    orphan,
    [],
    `深色族覆写了浅色不存在的 token（多半是拼写漂移）：${orphan.join(', ')}`,
  )
})
