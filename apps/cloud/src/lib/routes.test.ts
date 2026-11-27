import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { routes } from './routes'

/**
 * 路由守卫：routes 的每个路径都必须对应 src/app 下真实存在的 page.tsx
 * （动态段 [x] 按通配匹配）。删路由不删引用、或写错路径，在这里直接失败。
 */
const appDir = join(process.cwd(), 'src/app')

function pageRoutes(dir: string, prefix: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (/^\(/.test(name) && /\)$/.test(name)) out.push(...pageRoutes(full, prefix))
      else out.push(...pageRoutes(full, `${prefix}/${name}`))
    } else if (name === 'page.tsx' || name === 'route.ts') {
      out.push(prefix === '' ? '/' : prefix)
    }
  }
  return out
}

const existing = pageRoutes(appDir, '')
const toRegex = (p: string) =>
  new RegExp(`^${p.replace(/\[[^\]]+\]/g, '[^/]+').replace(/(.+)\/$/, '$1')}$`)

const candidates: Array<[string, string]> = [
  ['home', routes.home],
  ['login', routes.login],
  ['ops', routes.ops],
  ['workbench.index', routes.workbench.index],
  ['workbench.library', routes.workbench.library],
  ['workbench.course', routes.workbench.course('crs_x')],
  ['workbench.preview', routes.workbench.preview('crs_x', 's1')],
]

test('routes 的每条路径都对应 src/app 下真实存在的页面', () => {
  const missing = candidates
    .filter(([, path]) => !existing.some((r) => toRegex(r).test(path)))
    .map(([name]) => name)
  assert.deepEqual(missing, [], `以下路由没有对应 page（删路由请同步改 routes.ts）：${missing.join(', ')}`)
})

test('锚点路由的路径部分必须存在', () => {
  const base = routes.workbench.create.split('#')[0]!
  assert.ok(existing.some((r) => toRegex(r).test(base)), `锚点路由基路径不存在：${base}`)
})
