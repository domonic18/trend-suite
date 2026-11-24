-- ============================================================
-- 020 行情源可配置（教师端需求 P4）
--
-- 行情源从代码 hardcode 改为运营台维护：
--   market_quote_sources  行情源条目（is_default 全局唯一，运行时取默认源）
--
-- 不变量：
--   至多一个默认源（部分唯一索引）
--   查库失败 / 无默认源时运行时回退 env（worker 不因配置缺失而挂）
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- 本迁移只新增表，回退旧版本应用可继续运行。
-- ============================================================

CREATE TABLE IF NOT EXISTS market_quote_sources (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  base_url             text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  is_default           boolean NOT NULL DEFAULT false,
  note                 text,
  last_tested_at       timestamptz,
  last_test_result     text,
  last_test_latency_ms integer,
  last_test_error      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS market_quote_sources_default_idx
  ON market_quote_sources (is_default) WHERE is_default;

-- 预置默认源：腾讯 fqkline（与原 hardcode 同值，行为不变）。
-- id 由 md5 推导：幂等回放时 ON CONFLICT DO NOTHING 命中同一行。
INSERT INTO market_quote_sources (id, name, base_url, enabled, is_default, note)
VALUES ('mqs_' || substr(md5('tencent-fqkline'), 1, 16),
        '腾讯 fqkline',
        'https://web.ifzq.gtimg.cn',
        true, true,
        '腾讯前复权 K 线（预置默认源，协议口径见 arch/06 §5）')
ON CONFLICT (id) DO NOTHING;
