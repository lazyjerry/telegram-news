# 後端規格（Back-end Spec）

> **技術實作參考**：詳細的資料庫 SQL、API 規格、環境設定、程式骨架請參閱 [spec.md](./spec.md)

## 1. 系統架構

- 使用 Hono 框架，部署於 Cloudflare Workers
- D1 (SQLite) 作為資料庫，儲存貼文、訂閱、投遞紀錄
- 透過 Telegram Bot API 發送訊息
- 每小時由 Cron Trigger 觸發自動推播
- 流程：Producer → POST /api/ingest → D1(posts) → Cron → 依 subscriptions 送出訊息 → 記錄 deliveries → 全部送達後將 posts.published=1

## 2. 資料庫設計

### 主要資料表

- **posts**：儲存新聞貼文，url 為唯一鍵，支援 UPSERT
- **subscriptions**：儲存訂閱者（用戶/群組），含確認與過濾條件
- **deliveries**：記錄每則貼文對每個訂閱的投遞狀態

### 關鍵邏輯

- 以 url 為去重鍵，重複貼文執行 UPSERT 更新
- 一篇貼文需對「當下所有 enabled=1 的訂閱」皆 sent 才將 posts.published=1
- 詳細 SQL 結構請參閱 [spec.md - 資料庫設計](./spec.md#5-資料庫設計d1--sqlite)

## 3. API 端點

### 核心 API

- **POST /api/ingest**：驗證 X-API-Key，接收 JSON 格式貼文資料，寫入/更新 posts
- **POST /subscriptions**：管理訂閱與過濾條件（需 X-API-Key）
- **GET /subscriptions/:chat_id/status**：查詢訂閱狀態（需 X-API-Key）
- **DELETE /subscriptions/:chat_id**：停用訂閱（需 X-API-Key）
- **POST /admin/push?dry_run=1**：人工試跑推播
- **POST /tg/webhook**：接收 Telegram 更新，處理訂閱互動
- **GET /health**：健康檢查

### Telegram 指令處理

#### 基本指令

- **/start**：顯示歡迎訊息與使用說明
- **/subscribe**：開始訂閱流程，生成確認 token
- **/unsubscribe**：取消訂閱
- **/status**：查詢目前訂閱狀態
- **/list**：列出尚未推送的文章清單（包含標題、內容摘要、網址）

#### 訂閱確認流程

- 用戶輸入 `/subscribe` 後系統生成確認連結
- 確認 token 有效期 10 分鐘
- 點擊確認後將 `confirmed=1, enabled=1`
- **BUG 修復需求**：修復確認 token 驗證邏輯，解決「找不到對應的訂閱記錄」錯誤

#### 推播訊息格式

- **整合推播需求**：將新聞內容整合成一則完整訊息推送
- 訊息格式包含：標題、內容摘要、發布時間、來源連結
- 支援 Markdown 格式化，提升閱讀體驗

### 安全機制

- Header 驗證：`X-API-Key` 用於管理端點，`X-Telegram-Bot-Api-Secret-Token` 用於 webhook
- 詳細請求/回應格式請參閱 [spec.md - API 設計](./spec.md#6-api-設計hono)

## 4. 推播與排程系統

### Cron 觸發器

- 每小時整點執行：`0 * * * *`
- 查詢未發布貼文（posts.published=0），依 post_date_ts 排序
- 抓取啟用訂閱（enabled=1），篩選 filters_json 條件
- 送出 Telegram 訊息，寫入 deliveries 記錄
- 全部訂閱 sent 後標記 published=1

### 速率限制與重試

- 全域 ~30 訊息/秒，單一聊天 ≤1 訊息/秒，群組 ≤20/分鐘
- 處理 429/retry_after，實作指數退避
- 最多重試 3 次，失敗記錄於 deliveries.error、posts.last_error
- 詳細邏輯請參閱 [spec.md - 推播與排程](./spec.md#8-推播與排程)

## 5. 安全與稽核

### 認證與授權

- API 金鑰驗證：所有管理端點需 X-API-Key
- Webhook Secret 驗證：Telegram webhook 需 X-Telegram-Bot-Api-Secret-Token
- 輸入驗證與大小限制：單請求 results ≤ 100 條
- URL 白名單（可選）：限制貼文來源網域

### 日誌與監控

- 所有管理端點與排程操作皆寫 JSON log
- 記錄內容：post_id、chat_id、HTTP 狀態、執行耗時
- 錯誤與異常皆完整記錄，支援問題追蹤

## 6. 錯誤處理與重試

### 重試機制

- 外部 I/O 皆包裝重試（3 次，指數退避：1s, 2s, 4s...）
- Telegram API 429 錯誤：讀取 retry_after，延後相應秒數
- 全域退避：超過限制時指數回退，上限 30 秒

### 錯誤記錄

- 失敗投遞記錄於 deliveries.error、posts.last_error
- 累加 posts.attempt_count，支援失敗統計
- deliveries.status='failed' 的項目會在後續排程重試

## 7. 環境設定與部署

### 環境變數

- `TELEGRAM_BOT_TOKEN`：Bot Token（Secrets）
- `API_KEY`：私有 API 金鑰（Secrets）
- `TELEGRAM_WEBHOOK_SECRET`：Webhook 驗證密鑰（Secrets，建議）
- `DB`：D1 Binding 名稱

### 時區處理

- Worker 執行環境為 UTC
- 所有日期以 YYYY-MM-DD（Asia/Taipei）存於文字欄
- 同步存 \*\_ts（UTC Unix 秒）以利排序與查詢
- 詳細 wrangler.jsonc 設定請參閱 [spec.md - 環境與綁定](./spec.md#4-環境與綁定)

## 8. 驗收標準

### 功能驗收

1. /api/ingest 支援 UPSERT，相同 url 僅更新不重複
2. 僅向 enabled=1 AND confirmed=1 的訂閱推播
3. 全部成功後才標記 published=1
4. /admin/push?dry_run=1 不產生實際投遞與狀態變更
5. webhook 安全驗證：無效 Secret 回 401

### 效能要求

- 100 條貼文 ingest，平均延遲 ≤1s（99p ≤3s）
- Cron 每小時執行，具冪等性
- 失敗可重試且不重複投遞

### 系統限制

- 單一請求最多 100 條貼文（防止 OOM）
- Token bucket 算法：全域 ~25 訊息/秒，單聊天 1 訊息/秒
- 重試最多 3 次，指數退避（1s, 2s, 4s）
- 確認 Token 10 分鐘過期

詳細技術實作請參閱 [spec.md - 測試與驗收標準](./spec.md#16-測試與驗收標準)

## 8. 資料庫遷移與版本管理

### 遷移策略

- 使用 D1 migrations 管理資料庫版本
- 遷移檔案按時間序號命名：`0001_init.sql`, `0002_add_fields.sql`
- 支援本地開發與生產環境分別執行遷移

### 資料備份與恢復

- 定期匯出重要資料（posts, subscriptions）
- 災難恢復流程：重建 D1 → 執行遷移 → 匯入資料
- 重要操作前建立資料快照

## 9. 監控與運維

### 關鍵指標監控

- API 回應時間與錯誤率
- 推播成功率與失敗類型統計
- 資料庫查詢效能與連線狀態
- Cron 任務執行時間與頻率

### 警報與通知

- API 錯誤率 > 5% 自動警報
- 推播失敗率 > 10% 需要關注
- 資料庫連線中斷立即通知
- Cron 任務執行失敗或超時警報

### 日誌分析

- 結構化 JSON 日誌，支援查詢與分析
- 按組件、操作、錯誤類型分類統計
- 效能瓶頸識別與優化建議
