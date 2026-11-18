-- ============================================================
-- 009 逐节九步生产引擎（骨架）
--
-- 迭代 4（九步引擎骨架，占位级产物）落地：
--   production_tasks   逐节九步任务（arch/03 §2.2：course_id/section_id/step
--                      幂等 upsert 锚点；顺序强制、断点续跑、回灌挂起）
--   sections           产物节（占位最小集：placeholder jsonb 汇存九步占位产物；
--                      figures/widget_specs 等独立产物表留后续迭代）
--
-- 不变量：
--   production_tasks (course_id, section_id, step) 唯一（幂等 upsert / 重放防重复）
--   status 状态机 pending → running → done / failed / pending_manual
--   sections.status pending → complete；对外只认 complete（绝不部分落库）
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- ============================================================

-- ---------------------------------------------------------------- 逐节九步任务
CREATE TABLE IF NOT EXISTS production_tasks (
  id           text PRIMARY KEY,
  course_id    text NOT NULL,
  section_id   text NOT NULL,
  step         integer NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  checkpoint   jsonb NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_tasks_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT production_tasks_step_range CHECK (step BETWEEN 1 AND 9),
  CONSTRAINT production_tasks_status_check CHECK (status IN ('pending', 'running', 'done', 'failed', 'pending_manual')),
  CONSTRAINT production_tasks_step_key UNIQUE (course_id, section_id, step)
);

CREATE INDEX IF NOT EXISTS production_tasks_course_status_idx
  ON production_tasks (course_id, status);

-- ---------------------------------------------------------------- 产物节（占位最小集）
CREATE TABLE IF NOT EXISTS sections (
  id          text PRIMARY KEY,
  course_id   text NOT NULL,
  section_id  text NOT NULL,
  title       text NOT NULL DEFAULT '',
  sort_order  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'pending',
  placeholder jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT sections_course_section_key UNIQUE (course_id, section_id),
  CONSTRAINT sections_status_check CHECK (status IN ('pending', 'complete'))
);

CREATE INDEX IF NOT EXISTS sections_course_idx ON sections (course_id, sort_order);
