-- ============================================================
-- 018 制作历史回填对话流（迭代 11 反馈）
--
--   production_events（016，旧事实流）→ production 线程的 event 消息。
--
-- 迭代 11 之前的课程用旧表留痕，制作台对话流是空的——教师进制作台
-- 看不到这门课当时是怎么被做出来的。这里把旧事件按原顺序搬进
-- production 线程（教师读的那句话进 detail，级别按步状态推导）。
--
-- 幂等：只为「还没有任何消息」的线程回填；已在新链路里跑过消息的
-- 线程不动（不把旧历史插到新对话前面）。id 用 md5 派生（msg_ + 16hex，
-- 满足契约形状），重放不产生重复行。
-- ============================================================

-- 1) 有旧事件、还没有 production 线程的课程：以课程属主名义补建线程。
INSERT INTO agent_threads (id, course_id, phase, status, created_by)
SELECT 'thr_' || substr(md5(c.id || ':production:backfill'), 1, 16),
       c.id, 'production', 'open', c.owner_id
  FROM courses c
 WHERE EXISTS (SELECT 1 FROM production_events e WHERE e.course_id = c.id)
   AND NOT EXISTS (
     SELECT 1 FROM agent_threads t
      WHERE t.course_id = c.id AND t.phase = 'production' AND t.status = 'open'
   )
ON CONFLICT DO NOTHING;

-- 2) 旧事件搬进线程：只搬还没有任何消息的线程（全有或全无，保序）。
INSERT INTO agent_messages (id, thread_id, role, payload, created_at)
SELECT 'msg_' || substr(md5(e.id), 1, 16),
       t.id,
       'event',
       jsonb_build_object(
         'kind', e.kind,
         'detail', left(e.title || COALESCE('：' || NULLIF(e.detail, ''), ''), 500),
         'level', CASE
                    WHEN e.payload->>'status' IN ('failed', 'pending_manual') THEN 'err'
                    WHEN e.payload->>'status' = 'done' THEN 'ok'
                    ELSE 'info'
                  END
       ),
       e.created_at
  FROM production_events e
  JOIN agent_threads t
    ON t.course_id = e.course_id AND t.phase = 'production' AND t.status = 'open'
 WHERE NOT EXISTS (SELECT 1 FROM agent_messages m WHERE m.thread_id = t.id)
 ORDER BY e.course_id, e.seq;
