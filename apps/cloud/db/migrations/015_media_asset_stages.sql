-- ============================================================
-- 015 素材分析三段（逐字稿 / 关键帧 / 视频理解）
--
-- 落地：
--   media_asset_stages  每份素材的三段状态台账（空 / 进行中 / 完成 / 失败 + 失败原因）
--   pipeline_jobs.stage 分段任务标记：media_stage 任务跑哪一段
--
-- 背景：素材库是跨课程的全局视角（教师端需求 T4），三段分析各自要能单独看状态、
-- 单独重跑、单独删除结果。段的产出条数仍从产物表实时数（transcript_segments /
-- media_frames / source_units），这里只存「状态与失败原因」——状态与计数各归其位。
--
-- 不变量：
--   一个素材同一时刻最多一个在跑的分段任务（pipeline_jobs_active_idx 按 kind 去重，
--   media_stage 只有一个 kind，天然互斥）；
--   media_asset_stages (asset_id, stage) 是主键，状态写入幂等。
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表与列，回退旧版本应用可继续运行（表留着不碍事）。
-- ============================================================

-- ---------------------------------------------------------------- 三段状态台账
CREATE TABLE IF NOT EXISTS media_asset_stages (
  asset_id      text NOT NULL,
  stage         text NOT NULL,
  status        text NOT NULL DEFAULT 'empty',
  error_message text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_asset_stages_pkey PRIMARY KEY (asset_id, stage),
  CONSTRAINT media_asset_stages_asset_fkey FOREIGN KEY (asset_id) REFERENCES media_assets (id) ON DELETE CASCADE,
  CONSTRAINT media_asset_stages_stage_check
    CHECK (stage IN ('transcript', 'frames', 'understanding')),
  CONSTRAINT media_asset_stages_status_check
    CHECK (status IN ('empty', 'running', 'done', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS media_asset_stages_asset_idx ON media_asset_stages (asset_id);

-- ---------------------------------------------------------------- 分段任务标记
ALTER TABLE pipeline_jobs ADD COLUMN IF NOT EXISTS stage text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_jobs_stage_check'
  ) THEN
    ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_stage_check
      CHECK (stage IS NULL OR stage IN ('transcript', 'frames', 'understanding'));
  END IF;
END
$$;
