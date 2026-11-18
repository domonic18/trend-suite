-- ============================================================
-- 010 案例股与行情（数值可核）
--
-- 迭代 5（案例股与行情）落地：
--   section_case_stocks  节级案例股清单（九步第 1 步真实产物，
--                        arch/03 §2.3：代码/名称/交易所/周期/时间窗/事件锚点）
--   quote_bars           行情缓存（腾讯前复权 qfq，arch/06 §5：
--                        日线/周线原生周期，单源 tencent-qfq）
--
-- 不变量：
--   section_case_stocks (course_id, section_id, code, period) 唯一
--   （section_id 是课程内展示号、跨课复用，键必须带 course_id）
--   quote_bars (code, period, trade_date) 唯一（幂等 upsert / 重放防重复）
--   quote_bars 数值以源为准覆盖更新（数值可核：与源逐根一致）
--
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名。
-- ============================================================

-- ---------------------------------------------------------------- 节级案例股清单
CREATE TABLE IF NOT EXISTS section_case_stocks (
  id          text PRIMARY KEY,
  course_id   text NOT NULL,
  section_id  text NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  exchange    text NOT NULL,
  period      text NOT NULL,
  window_start date NOT NULL,
  window_end  date NOT NULL,
  events      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT section_case_stocks_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT section_case_stocks_exchange_check CHECK (exchange IN ('SH', 'SZ')),
  CONSTRAINT section_case_stocks_period_check CHECK (period IN ('1d', '1w')),
  CONSTRAINT section_case_stocks_window_check CHECK (window_start <= window_end),
  CONSTRAINT section_case_stocks_stock_key UNIQUE (course_id, section_id, code, period)
);

CREATE INDEX IF NOT EXISTS section_case_stocks_section_idx
  ON section_case_stocks (course_id, section_id);

-- ---------------------------------------------------------------- 行情缓存（腾讯前复权）
CREATE TABLE IF NOT EXISTS quote_bars (
  code       text NOT NULL,
  period     text NOT NULL,
  trade_date date NOT NULL,
  open       numeric NOT NULL,
  high       numeric NOT NULL,
  low        numeric NOT NULL,
  close      numeric NOT NULL,
  volume     bigint NOT NULL,
  source     text NOT NULL DEFAULT 'tencent-qfq',
  synced_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_bars_period_check CHECK (period IN ('1d', '1w')),
  CONSTRAINT quote_bars_bar_key UNIQUE (code, period, trade_date)
);

CREATE INDEX IF NOT EXISTS quote_bars_code_period_idx
  ON quote_bars (code, period, trade_date);
