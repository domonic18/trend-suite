-- ============================================================
-- 012 交互课件与断言证明（迭代 7）
--
-- 落地两张实建（arch/03 §2.2 设计 + arch/06 §9 契约）：
--   widget_specs       课件 spec 本体（11 类白名单，arch/06 §7）
--   widget_validations 断言的**程序证明**记录（arch/06 §8/§11）
--
-- 不变量：
--   widget_specs.type ∈ 11 类白名单；
--   code 仅 bar-replay-decision 非空（且为 6 位代码），其余类型必须 NULL——
--     正文 :::replay 按 code 定位（arch/06 §2.2），无 code 的类型不参与定位；
--   覆盖键 (course_id, section_id, type, code)：PG 里 NULL 互不相等，
--     故 10 类天然「无覆盖键」（同节同类可并存），bar-replay 按 (节, code) 覆盖；
--   widget_validations 只存程序证明，**无任何学员作答列**（arch/06 §11 隐私护栏）；
--   课件「全过才落库」由服务端事务保证（apps/cloud/src/server/content/widgets/service.ts），
--     本表不设「部分落库」路径。
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表，回退旧版本应用可继续运行（表留着不碍事）。
-- ============================================================

-- ---------------------------------------------------------------- 课件 spec
CREATE TABLE IF NOT EXISTS widget_specs (
  id           text PRIMARY KEY,
  course_id    text NOT NULL,
  -- 课程内大纲展示号（如 '1-1'），与 sections.section_id 同口径。
  section_id   text NOT NULL,
  type         text NOT NULL,
  -- 仅 bar-replay-decision 非空：正文 :::replay 按 code 定位课件。
  code         text,
  spec_version integer NOT NULL DEFAULT 1,
  -- 内容版本：覆盖写（回放课件按 (节, code) 唯一）时 widgetId 不变、version+1（arch/06 §12）。
  version      integer NOT NULL DEFAULT 1,
  spec         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT widget_specs_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT widget_specs_type_check CHECK (type IN (
    'kline-annotator', 'pattern-quiz', 'mcq-quiz', 'step-reveal', 'calc-trainer',
    'flashcards', 'checklist', 'timeline-explorer', 'image-juxtaposition',
    'branching-scenario', 'bar-replay-decision'
  )),
  -- code 的有无与类型绑定：回放类必填 6 位代码，其余类型必须为空。
  CONSTRAINT widget_specs_code_check CHECK (
    (type = 'bar-replay-decision' AND code ~ '^[0-9]{6}$')
    OR (type <> 'bar-replay-decision' AND code IS NULL)
  ),
  CONSTRAINT widget_specs_cover_key UNIQUE (course_id, section_id, type, code)
);

CREATE INDEX IF NOT EXISTS widget_specs_section_idx ON widget_specs (course_id, section_id);
CREATE INDEX IF NOT EXISTS widget_specs_code_idx ON widget_specs (course_id, code);

-- ---------------------------------------------------------------- 断言证明
-- 只有程序证明记录：无作答、无学员标识、无作答时间（arch/06 §11）。
CREATE TABLE IF NOT EXISTS widget_validations (
  widget_id  text NOT NULL,
  assertion  text NOT NULL,
  status     text NOT NULL DEFAULT 'pass',
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  detail     text NOT NULL DEFAULT '',
  proven_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (widget_id, assertion),
  CONSTRAINT widget_validations_widget_fkey FOREIGN KEY (widget_id) REFERENCES widget_specs (id) ON DELETE CASCADE,
  CONSTRAINT widget_validations_status_check CHECK (status IN ('pass', 'fail'))
);
