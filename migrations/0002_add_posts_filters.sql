-- 添加 posts 資料表的 filters_json 欄位
-- 用於支援貼文層級的篩選條件

ALTER TABLE posts ADD COLUMN filters_json TEXT;
