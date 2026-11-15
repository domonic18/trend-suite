-- ============================================================
-- 002 核心 schema：账号与会话、课程、素材
--
-- 001_init.sql 是空壳占位（仅注释），本迁移承载迭代 0 的基础实体。
-- 台账按**文件名**记账：已应用过的迁移文件不可改内容、不可复用文件名，
-- 否则台账会把它当已应用而跳过，线上 schema 与从零重放漂移（增量守卫即为此设）。
--
-- 不变量：
--   users.role ∈ {student, producer, operator, admin}；口令只存 scrypt 哈希
--   users.username 全局唯一
--   sessions.token_hash 唯一；库里只存令牌哈希，不存明文令牌
--   sessions 随 users 级联删除
--   courses.owner_id 必指向真实账号；课程恒为 draft 起手（producer 只写草稿）
--   media_assets.status 状态机：awaiting_upload → uploaded → processing → ready（失败 failed）
--
-- 回滚方式：迁移 forward-only，无自动回滚；回退靠发布前备份（deploy.sh 迁移前必备份）。
-- 本迁移只新增表与索引，不改写既有表，回退旧版本应用即可继续运行（表留着不碍事）。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- 账号与会话
CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  username      text NOT NULL,
  password_hash text NOT NULL,
  display_name  text,
  role          text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_role_check CHECK (role IN ('student', 'producer', 'operator', 'admin')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

-- ---------------------------------------------------------------- 课程
CREATE TABLE IF NOT EXISTS courses (
  id         text PRIMARY KEY,
  owner_id   text NOT NULL,
  title      text NOT NULL,
  status     text NOT NULL DEFAULT 'draft',
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courses_status_check CHECK (status IN ('draft', 'published')),
  CONSTRAINT courses_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS courses_owner_id_idx ON courses (owner_id);

-- ---------------------------------------------------------------- 素材
-- 迭代 0 只落数据模型；上传与加工（迭代 1/2）才有服务层写入。
CREATE TABLE IF NOT EXISTS media_assets (
  id            text PRIMARY KEY,
  course_id     text NOT NULL,
  original_name text,
  source_path   text,
  sha256        text,
  byte_size     bigint,
  duration_s    numeric,
  status        text NOT NULL DEFAULT 'awaiting_upload',
  hls_path      text,
  video_ok      boolean NOT NULL DEFAULT false,
  audio_ok      boolean NOT NULL DEFAULT false,
  error_code    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_status_check
    CHECK (status IN ('awaiting_upload', 'uploaded', 'processing', 'ready', 'failed')),
  CONSTRAINT media_assets_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS media_assets_course_id_idx ON media_assets (course_id);
