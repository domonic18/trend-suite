import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const appDir = fileURLToPath(new URL('../src/app/', import.meta.url))
const featuresDir = fileURLToPath(new URL('../src/features/', import.meta.url))
const nextConfig = (await import('../next.config.mjs')).default as {
  rewrites?: () => Promise<Array<{ source: string; destination: string }>>
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

test('对外 API 前缀 /v1/* 有 rewrite 兜到物理目录 /api/v1/*', async () => {
  const rewrites = (await nextConfig.rewrites?.()) ?? []
  const mapping = rewrites.find((r) => r.source === '/v1/:path*')
  assert.ok(mapping, 'next.config 缺少 /v1/:path* 的 rewrite')
  assert.equal(mapping.destination, '/api/v1/:path*')
})

test('所有 Route Handler 都落在 rewrite 覆盖得到的 /api/v1 下', () => {
  const handlers = walk(appDir).filter((f) => f.endsWith('route.ts'))
  const outside = handlers.filter((f) => {
    const rel = relative(appDir, f)
    return !rel.startsWith('api/v1/') && rel !== 'health/route.ts'
  })
  assert.deepEqual(
    outside.map((f) => relative(appDir, f)),
    [],
    'Route Handler 必须在 src/app/api/v1/ 下，否则 /v1/* 打不到'
  )
})

test('浏览器侧只按契约打 /v1/*，不打 /api/v1/*', () => {
  const offenders = walk(featuresDir)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => /['"`]\/api\/v1\//.test(readFileSync(f, 'utf8')))
  assert.deepEqual(offenders.map((f) => relative(featuresDir, f)), [])
})
