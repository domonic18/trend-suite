-- 迭代 12｜素材库去课程耦合（教师端需求 T4 改写）：素材独立上传入库。
-- 课程归属变为可空——归属关系改在建课勾选时建立（courses.plan_asset_ids），
-- 上传者身份由新增 created_by 承载（存量行从课程属主回填）。

ALTER TABLE media_assets ALTER COLUMN course_id DROP NOT NULL;

-- 理解先于建课发生：无主素材的理解单元 course_id 同样可空。
ALTER TABLE source_units ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS created_by text REFERENCES users (id);

-- 存量素材的属主 = 原归属课程的 owner（幂等：只补空值）。
UPDATE media_assets m
   SET created_by = c.owner_id
  FROM courses c
 WHERE m.course_id = c.id
   AND m.created_by IS NULL;

CREATE INDEX IF NOT EXISTS media_assets_created_by_idx ON media_assets (created_by);
