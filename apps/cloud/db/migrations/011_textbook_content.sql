-- ============================================================
-- 011 教材正文与图示（迭代 6）
--
-- 落地三张实建（arch/03 §2.2 设计 + 迭代 6 落地差异）：
--   source_units  事实回溯的最小证据单元（理解 Agent 产出，arch/05 §4）
--   figures       图示三路（keyframe/diagram/generated，arch/05 §8）
--   sections 补正文列（dsl_version / body / body_status）
--
-- 不变量：
--   source_units (asset_id, start_ms) 唯一（重跑按缺失 chunk 补齐的锚点）
--   figures (course_id, section_id, kind, caption) 唯一——
--     「同节 + 同 kind + 同 caption」覆盖更新，figureId 不变正文引用不失效；
--     section_id 是课程内展示号、跨课复用，键必须带 course_id（迭代 5 迁移 010 教训）
--   sections.body 只在校验通过后写入（绝不部分落库）；
--     迭代 4 占位产物汇存 placeholder jsonb，本迁移不迁移不清理
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表与列，回退旧版本应用可继续运行（表留着不碍事）。
-- ============================================================

-- ---------------------------------------------------------------- 证据单元
CREATE TABLE IF NOT EXISTS source_units (
  id           text PRIMARY KEY,
  course_id    text NOT NULL,
  asset_id     text NOT NULL,
  start_ms     integer NOT NULL,
  end_ms       integer NOT NULL,
  text         text NOT NULL,
  visual_desc  text,
  concept_refs text[] NOT NULL DEFAULT '{}',
  -- 理解产物的迭代面（图表类型/讲解要点/关键帧引用）走 jsonb，免随工艺 ALTER。
  extra        jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunk_index  integer NOT NULL DEFAULT 0,
  model_id     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_units_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT source_units_asset_fkey FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON DELETE CASCADE,
  CONSTRAINT source_units_asset_start_key UNIQUE (asset_id, start_ms),
  CONSTRAINT source_units_time_check CHECK (end_ms >= start_ms)
);

CREATE INDEX IF NOT EXISTS source_units_course_idx ON source_units (course_id);
CREATE INDEX IF NOT EXISTS source_units_chunk_idx ON source_units (asset_id, chunk_index);
CREATE INDEX IF NOT EXISTS source_units_concept_idx ON source_units USING gin (concept_refs);

-- ---------------------------------------------------------------- 图示三路
CREATE TABLE IF NOT EXISTS figures (
  id             text PRIMARY KEY,
  course_id      text NOT NULL,
  section_id     text NOT NULL,
  kind           text NOT NULL,
  caption        text NOT NULL,
  unit_id        text,
  asset_id       text,
  sec            integer,
  template       text,
  params         jsonb,
  prompt         text,
  image_model_id text,
  path           text,
  -- keyframe 落选中的 media_frames.id：签帧 URL 复用既有帧签名通道。
  frame_id       text,
  svg            text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT figures_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT figures_kind_check CHECK (kind IN ('keyframe', 'diagram', 'generated')),
  -- 覆盖键：同节同 kind 同 caption 视为同一张图（caption 为空会让正文引用漂移，故必填）。
  CONSTRAINT figures_cover_key UNIQUE (course_id, section_id, kind, caption)
);

CREATE INDEX IF NOT EXISTS figures_section_idx ON figures (course_id, section_id);

-- ---------------------------------------------------------------- 正文存储列
ALTER TABLE sections ADD COLUMN IF NOT EXISTS dsl_version integer;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE sections ADD COLUMN IF NOT EXISTS body_status text NOT NULL DEFAULT 'none';
