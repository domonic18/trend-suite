-- ============================================================
-- 007 课程方案与方案门禁
--
-- 迭代 3（课程骨架与方案门禁）落地：
--   courses            加 goal / outline_text / outline（目标与人工目录）
--   course_plans       方案版本轨迹（草案/批准/微调/打回，arch/05 §5 阶段三）
--   concepts           概念表（批准时才落库，arch/03 §2.2）
--   concept_edges      概念依赖边（prerequisite 无环由应用层校验）
--   ai_runs            模型调用台账（arch/07 §10，首次落表）
--   ai_usage_events    可计量用量事件
--   pipeline_jobs      队列通用化：素材维度或课程维度二选一
--
-- 不变量：
--   course_plans (course_id, version) 唯一；同课最多一个 draft、最多一个 approved
--   concepts 同课程名称唯一（重名拒绝，验收尺子 409）
--   pipeline_jobs 活跃任务（素材维度 COALESCE 课程维度，kind）唯一
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表与列，回退旧版本应用可继续运行（表留着不碍事）。
-- ============================================================

-- ---------------------------------------------------------------- 课程目标与目录
ALTER TABLE courses ADD COLUMN IF NOT EXISTS goal text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS outline_text text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS outline jsonb;

-- ---------------------------------------------------------------- 方案版本轨迹
CREATE TABLE IF NOT EXISTS course_plans (
  id             text PRIMARY KEY,
  course_id      text NOT NULL,
  version        integer NOT NULL,
  status         text NOT NULL DEFAULT 'draft',
  origin         text NOT NULL DEFAULT 'initial',
  parent_plan_id text REFERENCES course_plans (id),
  trigger_note   text,
  skeleton       jsonb NOT NULL,
  concept_map    jsonb NOT NULL,
  glossary       jsonb NOT NULL,
  section_plan   jsonb NOT NULL,
  violations     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_run_id      text,
  created_by     text NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT course_plans_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT course_plans_status_check CHECK (status IN ('draft', 'approved', 'superseded', 'rejected')),
  CONSTRAINT course_plans_origin_check CHECK (origin IN ('initial', 'revision', 'tweak')),
  CONSTRAINT course_plans_course_version_key UNIQUE (course_id, version)
);

CREATE INDEX IF NOT EXISTS course_plans_course_idx
  ON course_plans (course_id, created_at DESC);

-- 同课最多一个 draft / 一个 approved：应用层状态机 + 部分唯一索引双保险
CREATE UNIQUE INDEX IF NOT EXISTS course_plans_one_draft_idx
  ON course_plans (course_id) WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS course_plans_one_approved_idx
  ON course_plans (course_id) WHERE status = 'approved';

-- ---------------------------------------------------------------- 概念表（批准时落库）
CREATE TABLE IF NOT EXISTS concepts (
  id          text PRIMARY KEY,
  course_id   text NOT NULL,
  name        text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',
  definition  text,
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concepts_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT concepts_course_name_key UNIQUE (course_id, name)
);

CREATE INDEX IF NOT EXISTS concepts_aliases_idx ON concepts USING gin (aliases);

CREATE TABLE IF NOT EXISTS concept_edges (
  id           text PRIMARY KEY,
  course_id    text NOT NULL,
  from_concept text NOT NULL,
  to_concept   text NOT NULL,
  kind         text NOT NULL DEFAULT 'prerequisite',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concept_edges_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT concept_edges_from_fkey FOREIGN KEY (from_concept) REFERENCES concepts (id) ON DELETE CASCADE,
  CONSTRAINT concept_edges_to_fkey FOREIGN KEY (to_concept) REFERENCES concepts (id) ON DELETE CASCADE,
  CONSTRAINT concept_edges_pair_key UNIQUE (from_concept, to_concept, kind),
  CONSTRAINT concept_edges_kind_check CHECK (kind IN ('prerequisite', 'related')),
  CONSTRAINT concept_edges_no_self CHECK (from_concept <> to_concept)
);

-- ---------------------------------------------------------------- 模型调用台账（arch/07 §10）
-- 不记 prompt 与产物正文，只记数字、模型标识与摘要；冲正/审计语义见 arch 文档。
CREATE TABLE IF NOT EXISTS ai_runs (
  id          text PRIMARY KEY,
  source      text NOT NULL,
  task_key    text NOT NULL,
  ref_type    text NOT NULL,
  ref_id      text NOT NULL,
  model_id    text REFERENCES ai_models (id),
  model       text,
  provider    text,
  status      text NOT NULL DEFAULT 'running',
  tokens_in   integer,
  tokens_out  integer,
  latency_ms  integer,
  summary     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT ai_runs_source_check CHECK (source IN ('cloud', 'producer', 'student_qa')),
  CONSTRAINT ai_runs_status_check CHECK (status IN ('running', 'succeeded', 'failed'))
);

CREATE INDEX IF NOT EXISTS ai_runs_task_idx ON ai_runs (task_key, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_ref_idx ON ai_runs (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id         text PRIMARY KEY,
  run_id     text NOT NULL,
  kind       text NOT NULL,
  tokens_in  integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_events_run_fkey FOREIGN KEY (run_id) REFERENCES ai_runs (id) ON DELETE CASCADE,
  CONSTRAINT ai_usage_events_kind_check CHECK (kind IN ('tokens', 'images', 'asr'))
);

-- ---------------------------------------------------------------- 队列通用化：素材维度 / 课程维度二选一
ALTER TABLE pipeline_jobs ALTER COLUMN asset_id DROP NOT NULL;
ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS course_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_jobs_course_fkey') THEN
    ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_course_fkey
      FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_jobs_ref_check') THEN
    ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_ref_check
      CHECK ((asset_id IS NOT NULL) <> (course_id IS NOT NULL));
  END IF;
END $$;

DROP INDEX IF EXISTS pipeline_jobs_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_jobs_active_idx
  ON pipeline_jobs (COALESCE(asset_id, course_id), kind) WHERE status IN ('queued', 'running');
