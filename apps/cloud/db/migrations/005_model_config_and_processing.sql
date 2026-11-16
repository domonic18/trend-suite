-- ============================================================
-- 005 素材加工与模型配置
--
-- 迭代 2（素材加工）落地五张表，并给 media_assets 补加工进度列：
--   ai_models            模型条目（密钥 AES-GCM 密文，明文不入库）
--   ai_task_bindings     任务槽位的主备绑定
--   pipeline_jobs        加工任务队列（DB 队列 + worker 认领，arch/02 §4）
--   transcript_segments  转写段落（转写中先落 partial=true 的可读段落）
--   media_frames         关键帧
--
-- 不变量：
--   ai_models 每个用途最多一个默认条目（部分唯一索引）
--   pipeline_jobs 同一素材同一类型同时最多一个在跑的任务（部分唯一索引）
--   transcript_segments (asset_id, seq) 唯一：重跑不产生重复段落
--   media_frames (asset_id, at_ms) 唯一：重跑抽帧不产生重复关键帧
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表与列，回退旧版本应用可继续运行（表留着不碍事）。
-- ============================================================

-- ---------------------------------------------------------------- 模型条目
CREATE TABLE IF NOT EXISTS ai_models (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  purpose         text NOT NULL,
  provider        text NOT NULL,
  protocol        text NOT NULL,
  model           text NOT NULL,
  base_url        text,
  api_key_enc     text,
  status          text NOT NULL DEFAULT 'active',
  is_default      boolean NOT NULL DEFAULT false,
  capabilities    text[] NOT NULL DEFAULT '{}',
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  cooldown_until  timestamptz,
  last_tested_at  timestamptz,
  last_test_result text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_models_purpose_check
    CHECK (purpose IN ('llm', 'vlm', 'asr', 'embedding', 'image')),
  CONSTRAINT ai_models_protocol_check
    CHECK (protocol IN ('openai', 'anthropic', 'minimax')),
  CONSTRAINT ai_models_status_check
    CHECK (status IN ('active', 'cooling', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_models_default_per_purpose_idx
  ON ai_models (purpose) WHERE is_default AND status = 'active';

CREATE INDEX IF NOT EXISTS ai_models_purpose_idx ON ai_models (purpose, status);

-- ---------------------------------------------------------------- 任务绑定
CREATE TABLE IF NOT EXISTS ai_task_bindings (
  task             text PRIMARY KEY,
  primary_model_id text NOT NULL,
  backup_model_id  text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_task_bindings_primary_fkey FOREIGN KEY (primary_model_id) REFERENCES ai_models (id) ON DELETE CASCADE,
  CONSTRAINT ai_task_bindings_backup_fkey FOREIGN KEY (backup_model_id) REFERENCES ai_models (id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------- 加工任务队列
CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id               text PRIMARY KEY,
  asset_id         text NOT NULL,
  kind             text NOT NULL DEFAULT 'ingest',
  status           text NOT NULL DEFAULT 'queued',
  step             text NOT NULL DEFAULT 'uploaded',
  progress         numeric NOT NULL DEFAULT 0,
  attempts         integer NOT NULL DEFAULT 0,
  error_code       text,
  error_message    text,
  cancel_requested boolean NOT NULL DEFAULT false,
  available_at     timestamptz NOT NULL DEFAULT now(),
  locked_by        text,
  locked_at        timestamptz,
  heartbeat_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT pipeline_jobs_asset_fkey FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_jobs_active_idx
  ON pipeline_jobs (asset_id, kind) WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS pipeline_jobs_claim_idx
  ON pipeline_jobs (status, available_at);

-- ---------------------------------------------------------------- 转写段落
CREATE TABLE IF NOT EXISTS transcript_segments (
  id          text PRIMARY KEY,
  asset_id    text NOT NULL,
  seq         integer NOT NULL,
  start_ms    integer NOT NULL,
  end_ms      integer NOT NULL,
  speaker     text,
  text        text NOT NULL,
  unit_id     text,
  partial     boolean NOT NULL DEFAULT true,
  chunk_index integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transcript_segments_asset_seq_key UNIQUE (asset_id, seq),
  CONSTRAINT transcript_segments_asset_fkey FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON DELETE CASCADE,
  CONSTRAINT transcript_segments_time_check CHECK (end_ms >= start_ms)
);

CREATE INDEX IF NOT EXISTS transcript_segments_asset_idx
  ON transcript_segments (asset_id, seq);

CREATE INDEX IF NOT EXISTS transcript_segments_chunk_idx
  ON transcript_segments (asset_id, chunk_index);

-- ---------------------------------------------------------------- 关键帧
CREATE TABLE IF NOT EXISTS media_frames (
  id         text PRIMARY KEY,
  asset_id   text NOT NULL,
  at_ms      integer NOT NULL,
  path       text NOT NULL,
  width      integer,
  height     integer,
  caption    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_frames_asset_at_key UNIQUE (asset_id, at_ms),
  CONSTRAINT media_frames_asset_fkey FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_frames_asset_idx ON media_frames (asset_id, at_ms);

-- ---------------------------------------------------------------- 素材加工进度
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS process_step text NOT NULL DEFAULT 'uploaded';
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS process_progress numeric NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS process_message text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS segment_count integer NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS frame_count integer NOT NULL DEFAULT 0;
