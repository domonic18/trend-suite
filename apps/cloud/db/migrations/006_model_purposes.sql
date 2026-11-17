-- ============================================================
-- 006 — 模型条目多用途化（arch/07 §9 迭代 2 验收反馈）
--
-- 背景：原 purpose 单值列迫使同一模型按用途重复建档（如 GLM-4V 既做
--   内容生成又做视觉理解要建两条）。改 purposes text[] 多选：
--   一条条目可同时服务多个用途；capabilities 列全仓无消费，一并删除。
-- 厂商预置 base_url 是前端常量（features/models/providers.ts），不落库。
--
-- 变更：
--   ai_models + purposes text[]（回填 = 旧 purpose 单值），DROP purpose/
--   capabilities 列、purpose CHECK、purpose 相关索引
--   + GIN (purposes) 支撑数组包含查询（= ANY / &&）
--
-- 默认条目唯一性：原「每 purpose 一个默认」的部分唯一索引在数组列上
--   无法表达，改为应用层保证（service 层相交清除；运营台手工维护，
--   条目量级极小）。arch/07 §9 同步回写。
--
-- 幂等：全部 IF EXISTS / 分支守卫，可重复回放。
-- 回退旧版本应用可继续运行：旧代码读 purpose 列会失败——两环境必须
--   应用与迁移同版本发布（deploy.sh 迁移先行 + 同镜像保证）。
-- ============================================================

-- ---------------------------------------------------------------- ai_models 多用途化
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS purposes text[] NOT NULL DEFAULT '{}';

-- 回填：purposes = ARRAY[purpose]（仅尚未回填的行；purpose 列删除后该分支不再命中）
UPDATE ai_models
   SET purposes = ARRAY[purpose]
 WHERE cardinality(purposes) = 0
   AND EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'ai_models' AND column_name = 'purpose');

DROP INDEX IF EXISTS ai_models_default_per_purpose_idx;
DROP INDEX IF EXISTS ai_models_purpose_idx;

ALTER TABLE ai_models DROP CONSTRAINT IF EXISTS ai_models_purpose_check;
ALTER TABLE ai_models DROP COLUMN IF EXISTS capabilities;
ALTER TABLE ai_models DROP COLUMN IF EXISTS purpose;

CREATE INDEX IF NOT EXISTS ai_models_purposes_idx ON ai_models USING GIN (purposes);
