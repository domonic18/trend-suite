import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { persistFigures, type FigureSpec } from './figures-service'
import * as repo from './repo'

/**
 * 图示三路落库（arch/05 §8 / 验收③）：配额越界被明确拒绝（阻塞性 issue），
 * keyframe 证据接地（unitId/sec/帧），diagram 模板白名单，generated 一切失败
 * 剔除 + note 不挂步，覆盖更新保 id（正文引用不失效）。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

function unitIdFor(courseId: string): string {
  return `su_${createHash('sha256').update(courseId).digest('hex').slice(0, 16)}`
}

async function seedCourse(name: string): Promise<{ courseId: string; assetId: string; unitId: string }> {
  const username = `tushhi-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const assetId = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'seed.mp4', 'sources/nowhere/source', 'ready', 60)`,
    [assetId, course.id],
  )
  // 素材证据单元 20s~50s；30s 处有一帧（±2s 容差内可选中）
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, visual_desc, extra, chunk_index)
     VALUES ($1, $2, $3, 20000, 50000, '讲师手绘趋势线，讲解高低点抬升。', '讲师手绘趋势线', '{}', 0)`,
    [unitIdFor(course.id), course.id, assetId],
  )
  await query(
    `INSERT INTO media_frames (id, asset_id, at_ms, path) VALUES ($1, $2, 30000, '/tmp/seed-30000.jpg')`,
    [newId('mediaFrame'), assetId],
  )
  return { courseId: course.id, assetId, unitId: unitIdFor(course.id) }
}

function codeOf(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code)
}

test('keyframe + diagram 落库：unit/sec/帧接地，diagram 渲 SVG', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId: UNIT_ID } = await seedCourse('图示课')
  const sectionId = '1-1'
  const result = await persistFigures({
    courseId,
    sectionId,
    specs: [
      { kind: 'keyframe', caption: '讲师手绘趋势线', unitId: UNIT_ID, secHint: 30 },
      {
        kind: 'diagram',
        caption: '筹码对比',
        template: 'chip-contrast',
        params: { title: '密集 vs 发散', leftLabel: '密集', rightLabel: '发散', leftCount: 12, rightCount: 6 },
      },
    ] as FigureSpec[],
  })
  assert.deepEqual(result.issues, [])
  const figures = await repo.listFigures(courseId, sectionId)
  assert.equal(figures.length, 2)
  const keyframe = figures.find((f) => f.kind === 'keyframe')
  assert.ok(keyframe)
  assert.equal(keyframe?.unit_id, UNIT_ID)
  assert.equal(keyframe?.sec, 30)
  assert.equal(keyframe?.asset_id, (await query<{ asset_id: string }>(`SELECT asset_id FROM source_units WHERE id = $1`, [UNIT_ID]))[0]?.asset_id)
  assert.ok(keyframe?.frame_id, 'keyframe 落 ±2s 容差内选中帧')
  const diagram = figures.find((f) => f.kind === 'diagram')
  assert.ok(diagram?.svg?.includes('<svg'), 'diagram 服务端渲染 SVG')
})

test('keyframe 接地失败：unit 不存在 / sec 落窗外 / 无帧且补抽失败——全部阻塞性 issue', { skip }, async () => {
  const { courseId, unitId: UNIT_ID } = await seedCourse('图示接地课')
  const noUnit = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'keyframe', caption: '幽灵单元', unitId: 'su_' + 'b'.repeat(16) }],
  })
  assert.deepEqual(codeOf(noUnit.issues), ['unit_ref_unknown'])

  const outWindow = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'keyframe', caption: '窗外取帧', unitId: UNIT_ID, secHint: 100 }],
  })
  assert.deepEqual(codeOf(outWindow.issues), ['sec_not_grounded'])

  // 20s~50s 窗内的 45s：无现成帧、源文件也不存在 → 补抽失败
  const noFrame = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'keyframe', caption: '无帧取点', unitId: UNIT_ID, secHint: 45 }],
  })
  assert.deepEqual(codeOf(noFrame.issues), ['figure_not_grounded'])
})

test('验收③ 配额越界被明确拒绝：7 张 keyframe 一张都不落库', { skip }, async () => {
  const { courseId, unitId: UNIT_ID } = await seedCourse('图示配额课')
  const specs: FigureSpec[] = Array.from({ length: 7 }, (_, i) => ({
    kind: 'keyframe',
    caption: `关键帧${i}`,
    unitId: UNIT_ID,
    secHint: 30,
  }))
  const result = await persistFigures({ courseId, sectionId: '1-1', specs })
  assert.ok(codeOf(result.issues).includes('keyframe_quota_exceeded'))
  assert.ok(result.issues[0]?.message.includes('6'), '拒绝原因带配额数值')
  assert.equal((await repo.listFigures(courseId, '1-1')).length, 0, '阻塞性配额不落任何行')

  // 2 张 diagram 同样拒（配额 2）
  const diagrams: FigureSpec[] = [1, 2, 3].map((i) => ({
    kind: 'diagram',
    caption: `示意图${i}`,
    template: 'chip-contrast',
    params: { title: 't', leftLabel: 'l', rightLabel: 'r', leftCount: 10, rightCount: 8 },
  }))
  const result2 = await persistFigures({ courseId, sectionId: '2-1', specs: diagrams })
  assert.ok(codeOf(result2.issues).includes('diagram_quota_exceeded'))
})

test('diagram 白名单：模板外 / 参数违例都是阻塞性 issue', { skip }, async () => {
  const { courseId } = await seedCourse('图示白名单课')
  const badTemplate = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'diagram', caption: '坏模板', template: 'candlestick', params: {} }],
  })
  assert.deepEqual(codeOf(badTemplate.issues), ['template_not_allowed'])

  const badParams = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'diagram', caption: '坏参数', template: 'chip-contrast', params: { title: 't', leftCount: 999 } }],
  })
  assert.deepEqual(codeOf(badParams.issues), ['params_schema_failed'])
})

test('generated 未绑模型 → 剔除 + note，不产生阻塞性 issue', { skip }, async () => {
  const { courseId } = await seedCourse('图示装饰课')
  const result = await persistFigures({
    courseId,
    sectionId: '1-1',
    specs: [{ kind: 'generated', caption: '章节扉页装饰', prompt: '抽象蓝色几何装饰' }],
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.notes.length, 1)
  assert.ok(result.notes[0]?.includes('剔除'))
  assert.equal((await repo.listFigures(courseId, '1-1')).length, 0)
})

test('generated 章配额：本章已满 3 张，新装饰图剔除 + note', { skip }, async () => {
  const { courseId } = await seedCourse('图示章配额课')
  for (const sectionId of ['1-1', '1-2', '1-3']) {
    await query(
      `INSERT INTO figures (id, course_id, section_id, kind, caption, prompt)
       VALUES ($1, $2, $3, 'generated', $4, 'p')`,
      [newId('figure'), courseId, sectionId, `章内装饰${sectionId}`],
    )
  }
  const result = await persistFigures({
    courseId,
    sectionId: '1-4',
    specs: [{ kind: 'generated', caption: '再来一张', prompt: '抽象装饰' }],
  })
  assert.deepEqual(result.issues, [])
  assert.ok(result.notes[0]?.includes('本章'))
  // 下一章不受影响：配额按章计（这里未绑图像模型，走的是「未配置」剔除而非「本章配额」剔除）
  const next = await persistFigures({
    courseId,
    sectionId: '2-1',
    specs: [{ kind: 'generated', caption: '新章装饰', prompt: '抽象装饰' }],
  })
  assert.deepEqual(next.issues, [])
  assert.equal(next.notes.length, 1)
  assert.ok(next.notes[0]?.includes('未配置文生图模型'))
})

test('覆盖更新：同节同 kind 同 caption 复用原 figureId（正文引用不失效）', { skip }, async () => {
  const { courseId, unitId: UNIT_ID } = await seedCourse('图示覆盖课')
  const spec: FigureSpec = { kind: 'keyframe', caption: '讲师手绘趋势线', unitId: UNIT_ID, secHint: 30 }
  await persistFigures({ courseId, sectionId: '1-1', specs: [spec] })
  const first = (await repo.listFigures(courseId, '1-1'))[0]
  assert.ok(first)

  await persistFigures({ courseId, sectionId: '1-1', specs: [{ ...spec, secHint: 28 }] })
  const rows = await repo.listFigures(courseId, '1-1')
  assert.equal(rows.length, 1, '覆盖不新增行')
  assert.equal(rows[0]?.id, first.id, 'figureId 不变')
  assert.equal(rows[0]?.sec, 28, '字段按新产物更新')
})
