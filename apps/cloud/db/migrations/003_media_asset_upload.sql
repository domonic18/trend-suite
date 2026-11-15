-- ============================================================
-- 003 素材入库字段：直传凭据与失败原因
--
-- 002 已建 media_assets 表；迭代 1（素材入库）补三列：
--   expected_byte_size  直传凭据绑定的字节数上限（HMAC 的一部分）
--   expected_sha256     客户端声明的摘要（可选，不符即拒并清理半成品）
--   error_message       失败原因文案（静态文案，客户端只读不改）
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只加列，不改既有列语义，回退旧版本应用可继续运行。
-- ============================================================

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS expected_byte_size bigint;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS expected_sha256 text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS error_message text;
