-- ============================================================
-- 017 Agent 对话式交互（arch/08，迭代 11）
--
--   agent_threads   会话线程（每课每 phase 至多一个 open）
--   agent_messages  会话消息（只追加；seq = 增量游标，同 production_events 模式）
--
-- 消息按 role 判别（user/assistant/question/answer/todo/event），
-- payload 形状由 contracts/agent-chat.ts 定；唯一允许的更新是
-- question.answeredIndex 由答案处理器回写一次。
-- 替代 production_events 的写入路径：旧表保留不删、历史不迁移。
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_threads (
  id         text PRIMARY KEY,
  course_id  text NOT NULL,
  phase      text NOT NULL,
  status     text NOT NULL DEFAULT 'open',
  created_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_threads_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT agent_threads_phase_check CHECK (phase IN ('plan', 'production')),
  CONSTRAINT agent_threads_status_check CHECK (status IN ('open', 'closed'))
);

-- 每课每 phase 至多一个 open 线程：并发获取靠这个索引兜底。
CREATE UNIQUE INDEX IF NOT EXISTS agent_threads_one_open_idx
  ON agent_threads (course_id, phase) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS agent_messages (
  id         text PRIMARY KEY,
  thread_id  text NOT NULL REFERENCES agent_threads (id) ON DELETE CASCADE,
  -- 单调游标：线程内严格递增，前端按它增量拉取。
  seq        bigserial NOT NULL UNIQUE,
  role       text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 产生该消息的模型调用账目（event/todo 可空）。
  ai_run_id  text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_messages_role_check
    CHECK (role IN ('user', 'assistant', 'question', 'answer', 'todo', 'event'))
);

CREATE INDEX IF NOT EXISTS agent_messages_thread_seq_idx
  ON agent_messages (thread_id, seq);
