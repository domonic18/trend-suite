/**
 * 制作台目检种子：给预览演示课补上「九步生产」的中途态，
 * 让制作台（课时树 + 当前节工作区 + Agent 对话流）有真实数据可看。
 *
 * 只写本机运行期数据（本地库），不入库、不触线上环境。
 * 幂等：重复跑不产生重复行。
 *
 * 用法：node --env-file-if-exists=.env --conditions=react-server --import tsx \
 *   scripts/ops/seed-production-studio.ts
 */
import pg from 'pg'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('[seed-studio] 需要 DATABASE_URL')
  process.exit(1)
}

const COURSE_ID = 'crs_b2b2b2b2b2b2b2b2'
const DONE_SECTION = '1-1'
const RUNNING_SECTION = '1-2'
const QUEUED_SECTION = '1-3'
const JOB_ID = 'job_b3b3b3b3b3b3b3b3'

/** 九步键与中文名（与服务端 STEP_DEFS 同口径，事件流按步留痕用）。 */
const STEPS: { n: number; key: string; label: string }[] = [
  { n: 1, key: 'case_stocks', label: '案例股' },
  { n: 2, key: 'market_sync', label: '行情同步' },
  { n: 3, key: 'market_readback', label: '行情读回' },
  { n: 4, key: 'figure_spec', label: '图示' },
  { n: 5, key: 'replay_widget', label: '回放课件' },
  { n: 6, key: 'section_draft', label: '正文' },
  { n: 7, key: 'widgets', label: '其余课件' },
  { n: 8, key: 'review', label: '评审' },
  { n: 9, key: 'provenance', label: '溯源' },
]

const client = new pg.Client({ connectionString: databaseUrl })
await client.connect()
try {
  // 第二节与第三节（课时树要有多节才看得出层次）。
  for (const [sectionId, title, order] of [
    [RUNNING_SECTION, '趋势方向、能量与惯性', 2],
    [QUEUED_SECTION, '周期机会与趋势主线', 3],
  ] as const) {
    await client.query(
      `INSERT INTO sections (id, course_id, section_id, title, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (course_id, section_id) DO NOTHING`,
      [`sec_${sectionId.replace(/-/g, '')}`, COURSE_ID, sectionId, title, order],
    )
  }

  // 九步任务：三节各九行——完成 / 进行中 / 排队。
  const statusOf = (sectionId: string, step: number): string => {
    if (sectionId === DONE_SECTION) return 'done'
    if (sectionId === RUNNING_SECTION) {
      if (step <= 5) return 'done'
      if (step === 6) return 'running'
      return 'pending'
    }
    return 'pending'
  }
  for (const sectionId of [DONE_SECTION, RUNNING_SECTION, QUEUED_SECTION]) {
    for (const step of STEPS) {
      await client.query(
        `INSERT INTO production_tasks (id, course_id, section_id, step, status, attempts, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, now())
         ON CONFLICT (course_id, section_id, step) DO NOTHING`,
        [`pt_${sectionId.replace(/-/g, '')}${step.n}`, COURSE_ID, sectionId, step.n, statusOf(sectionId, step.n)],
      )
    }
  }
  await client.query(
    `UPDATE sections SET status = 'complete' WHERE course_id = $1 AND section_id = $2`,
    [COURSE_ID, DONE_SECTION],
  )

  // 正在跑的那节要有正文与出处——制作台要同步显示「做出来的内容 + 引用的素材」。
  await client.query(
    `INSERT INTO source_units (id, course_id, asset_id, start_ms, end_ms, text, visual_desc, extra)
     VALUES ($1, $2, $3, 90000, 150000, $4, $5, $6::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [
      'su_a5a5a5a5a5a5a5a5',
      COURSE_ID,
      'ast_d4d4d4d4d4d4d4d4',
      '老师讲惯性：方向一旦确立就不会立刻改变，反转需要结构破坏。',
      '老师在白板上画两条方向相反的折线对比。',
      JSON.stringify({
        frameIds: [],
        chartType: 'line',
        teachingPoints: ['方向确立后有惯性', '反转需要结构破坏'],
      }),
    ],
  )
  const runningBody = [
    '# 2. 趋势方向、能量与惯性',
    '',
    '## 2.1 方向与能量',
    '',
    '**方向**是价格运行的朝向，**能量**是推动这个朝向的强度。老师在原片里把两者分开讲：没有方向的趋势不成立，没有能量的趋势走不远。',
    '',
    ':::sidenote title="方向 vs 能量"',
    '方向回答「往哪走」，能量回答「能走多远」。',
    ':::',
    '',
    '## 2.2 惯性',
    '',
    '惯性指方向一旦确立就难以立刻改变：[[unit:su_a5a5a5a5a5a5a5a5|原片讲解：惯性与反转]]。老师强调判断反转不能靠感觉，要等**结构破坏**出现。',
    '',
    ':::board unitId="su_a5a5a5a5a5a5a5a5"',
    '惯性期里价格可以反复试探关键点，但只要结构没破，方向就还在。',
    ':::',
    '',
    ':::warn title="常见误用：把加速当反转" variant="misuse"',
    '斜率变陡只是能量变化，不等于方向反转。',
    ':::',
  ].join('\n')
  await client.query(
    `UPDATE sections SET body = $3, body_status = 'draft', dsl_version = 2
     WHERE course_id = $1 AND section_id = $2`,
    [COURSE_ID, RUNNING_SECTION, runningBody],
  )

  // 进行中那节的课件卡：从第一节复制三个课件（课件步已产出，断言证明一并带走）。
  const WIDGET_IDS: { from: string; to: string }[] = [
    { from: 'wid_a100000000000001', to: 'wid_b200000000000001' },
    { from: 'wid_a100000000000004', to: 'wid_b200000000000004' },
    { from: 'wid_a100000000000006', to: 'wid_b200000000000006' },
  ]
  for (const { from, to } of WIDGET_IDS) {
    await client.query(
      `INSERT INTO widget_specs (id, course_id, section_id, type, code, spec_version, version, spec)
       SELECT $2, course_id, $3, type, code, spec_version, version, spec
       FROM widget_specs WHERE id = $1
       ON CONFLICT (id) DO NOTHING`,
      [from, to, RUNNING_SECTION],
    )
    await client.query(
      `INSERT INTO widget_validations (widget_id, assertion, status, params, detail)
       SELECT $2, assertion, status, params, detail FROM widget_validations WHERE widget_id = $1
       ON CONFLICT (widget_id, assertion) DO NOTHING`,
      [from, to],
    )
  }

  // 在跑的生产任务（看板与停止按钮认它）。这课的生产任务由本脚本独占：
  // 先清掉旧行再插一条 id 合法的，免得留下不合契约的行（看板会因 job.id 校验失败）。
  await client.query(
    `DELETE FROM pipeline_jobs WHERE course_id = $1 AND kind = 'production_run'`,
    [COURSE_ID],
  )
  await client.query(
    `INSERT INTO pipeline_jobs (id, course_id, kind, status, step, progress, attempts)
     VALUES ($1, $2, 'production_run', 'running', 'running', 40, 1)`,
    [JOB_ID, COURSE_ID],
  )

  // 事件流：进行中那节的步事件（开始 / 完成）+ 工具卡（模型、耗时、token）。
  // 这课的事件也由本脚本独占：先清干净再重放，重复跑得到同一份演示。
  await client.query(`DELETE FROM production_events WHERE course_id = $1`, [COURSE_ID])
  {
    for (const step of STEPS.slice(0, 6)) {
      await client.query(
        `INSERT INTO production_events (id, course_id, section_id, kind, step, title, payload, created_at)
         VALUES ($1, $2, $3, 'step', $4, $5, $6::jsonb, now() - ($7 || ' minutes')::interval)`,
        [
          `pev_run_${step.n}_a`,
          COURSE_ID,
          RUNNING_SECTION,
          step.n,
          `第 ${step.n} 步「${step.label}」开始`,
          JSON.stringify({ status: 'running', stepKey: step.key, stepLabel: step.label }),
          String(30 - step.n * 4),
        ],
      )
      await client.query(
        `INSERT INTO production_events (id, course_id, section_id, kind, step, title, payload, created_at)
         VALUES ($1, $2, $3, 'step', $4, $5, $6::jsonb, now() - ($7 || ' minutes')::interval)`,
        [
          `pev_run_${step.n}_b`,
          COURSE_ID,
          RUNNING_SECTION,
          step.n,
          `第 ${step.n} 步「${step.label}」完成`,
          JSON.stringify({ status: 'done', stepKey: step.key, stepLabel: step.label }),
          String(29 - step.n * 4),
        ],
      )
      await client.query(
        `INSERT INTO production_events (id, course_id, section_id, kind, step, title, payload, created_at)
         VALUES ($1, $2, $3, 'tool', $4, $5, $6::jsonb, now() - ($7 || ' minutes')::interval)`,
        [
          `pev_run_${step.n}_t`,
          COURSE_ID,
          RUNNING_SECTION,
          step.n,
          `第 ${step.n} 步「${step.label}」调用模型 MiniMax-M2.1`,
          JSON.stringify({
            runId: `run_${step.n}`,
            model: 'MiniMax-M2.1',
            status: 'ok',
            latencyMs: 4200 + step.n * 900,
            tokensIn: 3200 + step.n * 240,
            tokensOut: 1800 + step.n * 160,
            stepKey: step.key,
            stepLabel: step.label,
          }),
          String(28 - step.n * 4),
        ],
      )
    }
  }

  console.log('[seed-studio] 就绪：课程', COURSE_ID, '· 三节九步 + 事件流')
} finally {
  await client.end()
}
