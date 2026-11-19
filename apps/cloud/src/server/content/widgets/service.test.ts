import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { resetTestDatabase, testDatabaseUrl } from '@/server/lib/test-db'
import { query } from '@/server/lib/db'
import { newId } from '@/server/lib/ids'
import { createAccount } from '@/server/accounts/service'
import { createCourse } from '@/server/content/service'
import { persistWidgets } from './service'
import * as repo from './repo'

/**
 * 课件落库语义（arch/06 §9/§11/§12）：
 * - **全过才落库**：任一断言不成立 → 一行不落（引擎回灌重写）；
 * - **重跑不增殖**：步骤 7 整批替换，同节同类多份并存；
 * - **回放按覆盖键**：(节, code) 覆盖写，widgetId 不变、version+1；
 * - **步与类型绑定**：回放步只收 bar-replay-decision，其余步只收别的类型；
 * - **只存程序证明**：widget_validations 无任何学员作答列。
 */

const url = testDatabaseUrl()
if (url) process.env.DATABASE_URL = url
const skip = url ? false : '未配置 TEST_DATABASE_URL'

process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
process.env.MEDIA_STORAGE = 'local'

const SECTION_ID = '1-1'
const CODE = '600519'
const TRADING_DAYS = ['2023-01-06', '2023-05-05', '2023-06-02']

function unitIdFor(courseId: string): string {
  return `su_${createHash('sha256').update(courseId).digest('hex').slice(0, 16)}`
}

async function seedCourse(name: string): Promise<{ courseId: string; unitId: string }> {
  const username = `tushhi-${randomBytes(4).toString('hex')}`
  const teacher = await createAccount({ username, password: 'correct-horse', role: 'producer' })
  const course = await createCourse(teacher.id, name)
  const unitId = unitIdFor(course.id)

  for (const concept of ['趋势', '级别']) {
    await query(
      `INSERT INTO concepts (id, course_id, name, definition) VALUES ($1, $2, $3, '')`,
      [newId('concept'), course.id, concept],
    )
  }
  const assetId = newId('mediaAsset')
  await query(
    `INSERT INTO media_assets (id, course_id, original_name, source_path, status, duration_s)
     VALUES ($1, $2, 'seed.mp4', 'sources/nowhere/source', 'ready', 60)`,
    [assetId, course.id],
  )
  await query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, visual_desc, extra, chunk_index)
     VALUES ($1, $2, $3, 20000, 50000, '讲师手绘趋势线。', '讲师手绘趋势线', '{}', 0)`,
    [unitId, course.id, assetId],
  )
  await query(
    `INSERT INTO section_case_stocks
       (id, course_id, section_id, code, name, exchange, period, window_start, window_end)
     VALUES ($1, $2, $3, $4, '贵州茅台', 'SH', '1w', '2023-01-01', '2023-12-31')`,
    [newId('caseStock'), course.id, SECTION_ID, CODE],
  )
  for (const [index, day] of TRADING_DAYS.entries()) {
    await query(
      `INSERT INTO quote_bars (code, period, trade_date, open, high, low, close, volume)
       VALUES ($1, '1w', $2::date, $3, $4, $5, $6, $7)`,
      [CODE, day, 100 + index, 105 + index, 99 + index, 103 + index, 1000],
    )
  }
  return { courseId: course.id, unitId }
}

/** 合规的 mcq-quiz 草稿（可据以改坏的字段由调用方覆盖）。 */
function mcqDraft(unitId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'mcq-quiz',
    citations: [unitId],
    assertions: {},
    question: '判断趋势延续的首要依据是什么？',
    options: [
      { id: 'a', label: '高点与低点依次抬升' },
      { id: 'b', label: '单根 K 线涨跌' },
    ],
    answerId: 'a',
    conceptRefs: ['趋势'],
    ...overrides,
  }
}

/** 合规的回放课件草稿。 */
function replayDraft(unitId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'bar-replay-decision',
    citations: [unitId],
    assertions: {},
    code: CODE,
    window: { from: '2023-01-01', to: '2023-12-31' },
    period: '1w',
    annotations: [
      { unitId, atMs: 30000, kind: 'structure', d: '2023-06-02', label: '周线级别抬升的高点' },
    ],
    decisions: [
      {
        atDate: '2023-05-05',
        question: '趋势是延续还是反转？',
        options: [{ label: '延续' }, { label: '反转' }],
        correct: '延续',
        revealText: '后市重心继续上移，趋势被验证。',
        unitId,
        atMs: 30000,
      },
    ],
    ...overrides,
  }
}

test('全过才落库：课件与断言证明记录一并入库', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('课件课')

  const result = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [mcqDraft(unitId)],
    mode: 'batch',
  })
  assert.deepEqual(result.issues, [])
  assert.equal(result.persisted, 1)

  const widgets = await repo.listWidgets(courseId, SECTION_ID)
  assert.equal(widgets.length, 1)
  assert.equal(widgets[0]?.type, 'mcq-quiz')
  assert.equal(widgets[0]?.code, null, '非回放课件不带 code')

  const proofs = await repo.listValidations([widgets[0]!.id])
  assert.deepEqual(
    proofs.map((proof) => proof.assertion).sort(),
    ['answerUnique', 'termsInConcepts'],
  )
  assert.ok(proofs.every((proof) => proof.status === 'pass'))
})

test('断言不成立 → 一行不落（问题清单回灌）', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('断言不过课')

  const result = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [mcqDraft(unitId, { conceptRefs: ['均线'] })],
    mode: 'batch',
  })
  assert.equal(result.persisted, 0)
  assert.ok(result.issues.length > 0)
  assert.equal(result.issues[0]?.assertion, 'termsInConcepts')
  assert.deepEqual(await repo.listWidgets(courseId, SECTION_ID), [], '一行都不落')
})

test('引用的素材单元不存在 → 拒绝', { skip }, async () => {
  await resetTestDatabase()
  const { courseId } = await seedCourse('引用不接地课')

  const result = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [mcqDraft('su_ffffffffffffffff')],
    mode: 'batch',
  })
  assert.equal(result.persisted, 0)
  assert.equal(result.issues[0]?.code, 'citation_unknown')
})

test('重跑不增殖：步骤 7 整批替换，同节同类多份并存', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('重跑课')

  await persistWidgets({ courseId, sectionId: SECTION_ID, drafts: [mcqDraft(unitId)], mode: 'batch' })
  await persistWidgets({ courseId, sectionId: SECTION_ID, drafts: [mcqDraft(unitId)], mode: 'batch' })
  assert.equal((await repo.listWidgets(courseId, SECTION_ID)).length, 1, '重跑不增殖')

  // 同批内两份同类课件并存（无覆盖键）。
  await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [mcqDraft(unitId), mcqDraft(unitId, { question: '另一个问题' })],
    mode: 'batch',
  })
  assert.equal((await repo.listWidgets(courseId, SECTION_ID)).length, 2)
})

test('回放课件按 (节, code) 覆盖：widgetId 不变、version+1', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('回放覆盖课')

  await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [replayDraft(unitId)],
    mode: 'replay',
  })
  const first = (await repo.listWidgets(courseId, SECTION_ID))[0]!
  assert.equal(first.type, 'bar-replay-decision')
  assert.equal(first.code, CODE)
  assert.equal(first.version, 1)

  await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [
      replayDraft(unitId, {
        decisions: [
          {
            atDate: '2023-05-05',
            question: '换个问法：趋势是延续还是反转？',
            options: [{ label: '延续' }, { label: '反转' }],
            correct: '延续',
            revealText: '后市重心继续上移，趋势被验证。',
            unitId,
            atMs: 30000,
          },
        ],
      }),
    ],
    mode: 'replay',
  })
  const second = (await repo.listWidgets(courseId, SECTION_ID))[0]!
  assert.equal(second.id, first.id, '覆盖写不改 widgetId')
  assert.equal(second.version, 2, '内容版本递增')
  assert.equal((await repo.listWidgets(courseId, SECTION_ID)).length, 1)
})

test('步与类型绑定：回放步只收回放课件，其余步只收别的类型', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('步型绑定课')

  const wrongInReplay = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [mcqDraft(unitId)],
    mode: 'replay',
  })
  assert.equal(wrongInReplay.persisted, 0)
  assert.match(wrongInReplay.issues[0]?.message ?? '', /回放步只接受/)

  const wrongInBatch = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [replayDraft(unitId)],
    mode: 'batch',
  })
  assert.equal(wrongInBatch.persisted, 0)
  assert.match(wrongInBatch.issues[0]?.message ?? '', /只能产在回放步/)
})

test('回放课件的案例股不在本节清单内 → 拒绝', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('陌生案例股课')

  const result = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [replayDraft(unitId, { code: '000001' })],
    mode: 'replay',
  })
  assert.equal(result.persisted, 0)
  assert.match(result.issues[0]?.message ?? '', /不在本节案例股清单内/)
})

test('回放课件的判断点日期不是真实交易日 → 拒绝', { skip }, async () => {
  await resetTestDatabase()
  const { courseId, unitId } = await seedCourse('非交易日课')

  const result = await persistWidgets({
    courseId,
    sectionId: SECTION_ID,
    drafts: [
      replayDraft(unitId, {
        decisions: [
          {
            atDate: '2023-05-06',
            question: '趋势是延续还是反转？',
            options: [{ label: '延续' }, { label: '反转' }],
            correct: '延续',
            revealText: '后市重心继续上移，趋势被验证。',
            unitId,
            atMs: 30000,
          },
        ],
      }),
    ],
    mode: 'replay',
  })
  assert.equal(result.persisted, 0)
  assert.equal(result.issues[0]?.assertion, 'decisionPointsGrounded')
  assert.deepEqual(await repo.listWidgets(courseId, SECTION_ID), [])
})
