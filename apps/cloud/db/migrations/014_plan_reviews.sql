-- 迭代 8：规划自检记录（plan_reviews）
--
-- 规划自检不通过的方案不呈现给教师：失败项落这里，教师看到的是待办与原因，
-- 不是坏草案。自检结论随草案版本留痕，便于追溯某版目录为什么被放行。

CREATE TABLE IF NOT EXISTS plan_reviews (
  id          text PRIMARY KEY,
  course_id   text NOT NULL,
  plan_id     text REFERENCES course_plans (id) ON DELETE SET NULL,
  status      text NOT NULL,
  attempts    integer NOT NULL DEFAULT 1,
  issues      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plan_reviews_course_fkey FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
  CONSTRAINT plan_reviews_status_check CHECK (status IN ('pass', 'fail', 'manual'))
);

CREATE INDEX IF NOT EXISTS plan_reviews_course_idx
  ON plan_reviews (course_id, created_at DESC);
