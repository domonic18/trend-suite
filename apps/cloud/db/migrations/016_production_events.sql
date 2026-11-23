-- 制作页 Agent 事件流（教师端需求 T21）：步状态变化 / 模型调用 / 停止点。
--
-- 九步生产原本只有「当前状态」（production_tasks），没有「发生过什么」——
-- 教师看不到 Agent 正在做什么，也看不到自己按下停止后停在了哪一步。
-- 这里补一条只增不改的事件流：seq 单调递增即增量游标，
-- 前端带游标续读，不必每次全量拉。
CREATE TABLE IF NOT EXISTS production_events (
  id text PRIMARY KEY,
  course_id text NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  -- 事件所属节（目录节 id）；课程级事件（如停止）可空。
  section_id text,
  -- 单调游标：同一课程内严格递增，前端按它增量拉取。
  seq bigserial NOT NULL,
  -- step = 步状态变化 / tool = 一次模型调用 / stop = 教师按下停止。
  kind text NOT NULL,
  -- 步序（1–9），非步事件可空。
  step integer,
  -- 教师读的那句话。
  title text NOT NULL,
  detail text,
  -- 补充事实（模型、耗时、token、状态……），不记产物正文。
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_events_course_seq_idx
  ON production_events (course_id, seq);
