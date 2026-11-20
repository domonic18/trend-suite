-- ============================================================
-- 013 智能规划（迭代 8）
--
-- 落地：课程上的规划输入（模式 + 参与规划的素材集）。
--   courses.plan_mode       smart（智能规划）/ follow_manual（沿用人工目录骨架）
--   courses.plan_asset_ids  本次参与规划的素材 id 列表（NULL = 课程全部素材）
--
-- 背景：目录规模必须由素材推导（素材理解产出的教学要点是天然上界），
-- 而不是与素材无关的绝对上限。规划要支持「教师勾选多个视频做总体章节规划」。
--
-- 不变量：
--   plan_mode ∈ {smart, follow_manual}；
--   plan_asset_ids 为空或 NULL 时表示「课程全部素材」。
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增列，回退旧版本应用可继续运行（列留着不碍事）。
-- ============================================================

ALTER TABLE courses ADD COLUMN IF NOT EXISTS plan_mode text;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS plan_asset_ids text[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_plan_mode_check'
  ) THEN
    ALTER TABLE courses ADD CONSTRAINT courses_plan_mode_check
      CHECK (plan_mode IS NULL OR plan_mode IN ('smart', 'follow_manual'));
  END IF;
END
$$;
