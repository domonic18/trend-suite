-- 模型连通性测试结果随条目落库（arch/07 §9.1，对齐家族 aitech-hub 形态）：
-- 状态沿用 last_test_result（ok/failed），新增延迟与失败原因，运营台列表内联展示。
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS last_test_latency_ms integer;
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS last_test_error text;
