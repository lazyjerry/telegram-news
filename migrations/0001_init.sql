-- Telegram 新聞推播系統 - 初始資料庫結構
-- 繁體中文註解：此檔案建立系統所需的基本資料表結構

-- 新聞貼文資料表
-- 用於儲存從外部 API 接收的新聞內容
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_username TEXT NOT NULL,          -- 新聞來源使用者名稱
  start_date TEXT,                        -- 活動開始日期 YYYY-MM-DD（Asia/Taipei）
  end_date TEXT,                          -- 活動結束日期 YYYY-MM-DD（Asia/Taipei）
  post_date TEXT NOT NULL,                -- 新聞發布日期 YYYY-MM-DD（Asia/Taipei）
  post_date_ts INTEGER,                   -- 新聞發布時間戳（UTC Unix 秒）
  summary TEXT NOT NULL,                  -- 新聞摘要內容
  url TEXT NOT NULL,                      -- 新聞連結
  get_date TEXT NOT NULL,                 -- 資料擷取日期 YYYY-MM-DD（Asia/Taipei）
  get_date_ts INTEGER,                    -- 資料擷取時間戳（UTC Unix 秒）
  published INTEGER NOT NULL DEFAULT 0,   -- 是否已推播（0=未推播, 1=已推播）
  published_at_ts INTEGER,                -- 推播完成時間戳（UTC Unix 秒）
  attempt_count INTEGER NOT NULL DEFAULT 0, -- 推播嘗試次數
  last_error TEXT,                        -- 最後一次錯誤訊息
  created_at_ts INTEGER NOT NULL,         -- 記錄建立時間戳（UTC Unix 秒）
  updated_at_ts INTEGER NOT NULL,         -- 記錄更新時間戳（UTC Unix 秒）
  UNIQUE(url)                             -- URL 唯一性約束，防止重複新聞
);

-- 訂閱者資料表
-- 用於管理 Telegram 聊天（個人或群組）的訂閱狀態
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,                  -- Telegram 聊天 ID（個人為正數，群組為負數）
  enabled INTEGER NOT NULL DEFAULT 1,     -- 訂閱狀態（0=停用, 1=啟用）
  confirmed INTEGER NOT NULL DEFAULT 0,   -- 是否已確認訂閱（0=未確認, 1=已確認）
  confirm_token TEXT,                     -- 訂閱確認 token（一次性使用）
  confirm_token_expire_ts INTEGER,        -- Token 到期時間戳（UTC Unix 秒）
  confirmed_at_ts INTEGER,                -- 確認訂閱時間戳（UTC Unix 秒）
  filters_json TEXT,                      -- 過濾條件（JSON 格式，如：{"usernames":["foo","bar"]}）
  created_at_ts INTEGER NOT NULL,         -- 記錄建立時間戳（UTC Unix 秒）
  updated_at_ts INTEGER NOT NULL,         -- 記錄更新時間戳（UTC Unix 秒）
  UNIQUE(chat_id)                         -- 每個聊天 ID 只能有一個訂閱記錄
);

-- 推播記錄資料表
-- 用於追蹤每則新聞對每個訂閱者的推播狀態
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,               -- 關聯的新聞 ID
  subscription_id INTEGER NOT NULL,       -- 關聯的訂閱 ID
  chat_id TEXT NOT NULL,                  -- Telegram 聊天 ID（冗余欄位，便於查詢）
  status TEXT NOT NULL DEFAULT 'pending', -- 推播狀態（pending/sent/failed）
  sent_at_ts INTEGER,                     -- 成功送達時間戳（UTC Unix 秒）
  error TEXT,                             -- 錯誤訊息（如果推播失敗）
  retry_count INTEGER NOT NULL DEFAULT 0, -- 重試次數
  created_at_ts INTEGER NOT NULL,         -- 記錄建立時間戳（UTC Unix 秒）
  updated_at_ts INTEGER NOT NULL,         -- 記錄更新時間戳（UTC Unix 秒）
  FOREIGN KEY (post_id) REFERENCES posts(id),           -- 外鍵約束：關聯新聞
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id), -- 外鍵約束：關聯訂閱
  UNIQUE(post_id, subscription_id)        -- 防止重複推播記錄
);

-- 建立索引以提升查詢效能
-- posts 資料表索引
CREATE INDEX IF NOT EXISTS idx_posts_url ON posts(url);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published);
CREATE INDEX IF NOT EXISTS idx_posts_created_ts ON posts(created_at_ts);
CREATE INDEX IF NOT EXISTS idx_posts_source_username ON posts(source_username);

-- subscriptions 資料表索引
CREATE INDEX IF NOT EXISTS idx_subscriptions_chat_id ON subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON subscriptions(enabled);
CREATE INDEX IF NOT EXISTS idx_subscriptions_confirmed ON subscriptions(confirmed);
CREATE INDEX IF NOT EXISTS idx_subscriptions_confirm_token ON subscriptions(confirm_token);

-- deliveries 資料表索引
CREATE INDEX IF NOT EXISTS idx_deliveries_post_id ON deliveries(post_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_subscription_id ON deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_chat_id ON deliveries(chat_id);
