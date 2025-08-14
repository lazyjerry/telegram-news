# Telegram 新聞推播系統開發任務清單

> 📋 **規格參考**：詳細技術規格請參閱 [spec.md](./spec.md)、[back-spec.md](./back-spec.md)、[front-spec.md](./front-spec.md)

---

## 🏗️ 第一階段：環境建置與基礎架構

### 1. 專案初始化與環境設定

1. [ ] **1.1** 初始化 Cloudflare Workers 專案，設定 wrangler.toml

   - **執行步驟**：
     1. 建立專案目錄：`mkdir telegram-news && cd telegram-news`
     2. 初始化專案：`wrangler init telegram-news --yes`
     3. 建立 `src` 資料夾結構：`mkdir -p src/{types,utils,handlers,services}`
     4. 設定 `wrangler.toml`，配置專案名稱、相容性日期、cron 觸發器
     5. 安裝依賴：`npm install hono @types/node`
   - **驗證標準**：
     - `wrangler.toml` 包含正確的 cron 設定 `["0 * * * *"]`
     - 專案結構符合 Hono 最佳實務
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證專案結構正確。
   - 參考：[spec.md - 環境與綁定](./spec.md#4-環境與綁定)

2. [ ] **1.2** 建立 D1 資料庫實例，設定 database_id 綁定

   - **執行步驟**：
     1. 建立 D1 資料庫：`wrangler d1 create telegram_news_db`
     2. 記錄回傳的 database_id
     3. 更新 `wrangler.toml`，添加 D1 綁定設定
     4. 建立初始 SQL 遷移檔：`migrations/0001_init.sql`
     5. 測試本地連線：`wrangler d1 execute telegram_news_db --command "SELECT 1"`
   - **驗證標準**：
     - D1 資料庫成功建立且可連線
     - `wrangler.toml` 包含正確的 database_id 綁定
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 D1 連線正常。
   - 執行：`wrangler d1 create telegram_news_db`

3. [ ] **1.3** 設定環境變數與 Secrets（TELEGRAM_BOT_TOKEN, API_KEY, TELEGRAM_WEBHOOK_SECRET）
   - **執行步驟**：
     1. 建立 Telegram Bot，取得 BOT_TOKEN（透過 @BotFather）
     2. 產生 API_KEY：`openssl rand -hex 32`
     3. 產生 WEBHOOK_SECRET：`openssl rand -hex 16`
     4. 設定 Secrets：
        ```bash
        wrangler secret put TELEGRAM_BOT_TOKEN
        wrangler secret put API_KEY
        wrangler secret put TELEGRAM_WEBHOOK_SECRET
        ```
     5. 建立 `.env.example` 檔案作為範本
     6. 在 `.gitignore` 中排除 `.env` 檔案
   - **驗證標準**：
     - 所有 Secrets 成功設定且可在 Cloudflare Dashboard 中看到
     - Telegram Bot 可正常回應 `getMe` API 呼叫
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 Secrets 設定。
   - 執行：`wrangler secret put TELEGRAM_BOT_TOKEN` 等

### 2. 資料庫結構建立

4. [ ] **2.1** 建立 posts 資料表與索引

   - **執行步驟**：
     1. 建立遷移檔：`migrations/0001_create_posts.sql`
     2. 根據 spec.md 中的 SQL 結構定義建立 posts 資料表
     3. 添加索引：`CREATE INDEX idx_posts_url ON posts(url);`
     4. 添加索引：`CREATE INDEX idx_posts_created_ts ON posts(created_ts);`
     5. 執行遷移：`wrangler d1 migrations apply telegram_news_db --local`
     6. 驗證資料表：`wrangler d1 execute telegram_news_db --command "SELECT name FROM sqlite_master WHERE type='table'"`
   - **驗證標準**：
     - posts 資料表成功建立，包含所有必要欄位
     - URL 唯一性約束正常運作
     - 索引正確建立且查詢效能良好
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證資料表結構正確。
   - 參考：[spec.md - 資料庫設計](./spec.md#5-資料庫設計d1--sqlite)

5. [ ] **2.2** 建立 subscriptions 資料表與索引

   - **執行步驟**：
     1. 建立遷移檔：`migrations/0002_create_subscriptions.sql`
     2. 根據 spec.md 定義建立 subscriptions 資料表
     3. 包含 confirm_token, confirm_token_expire_ts 等訂閱確認相關欄位
     4. 添加索引：`CREATE INDEX idx_subscriptions_chat_id ON subscriptions(chat_id);`
     5. 添加索引：`CREATE INDEX idx_subscriptions_confirm_token ON subscriptions(confirm_token);`
     6. 執行遷移並驗證資料表結構
   - **驗證標準**：
     - subscriptions 資料表正確建立，包含所有訂閱管理欄位
     - chat_id 唯一性約束正常運作
     - confirm_token 相關邏輯可正常運作
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證資料表結構正確。
   - 包含：confirm_token, confirm_token_expire_ts 等欄位

6. [ ] **2.3** 建立 deliveries 資料表與外鍵約束
   - **執行步驟**：
     1. 建立遷移檔：`migrations/0003_create_deliveries.sql`
     2. 根據 spec.md 建立 deliveries 資料表，包含外鍵關聯
     3. 設定 UNIQUE(post_id, subscription_id) 約束防止重複傳送
     4. 添加索引：`CREATE INDEX idx_deliveries_post_id ON deliveries(post_id);`
     5. 添加索引：`CREATE INDEX idx_deliveries_subscription_id ON deliveries(subscription_id);`
     6. 測試外鍵約束與唯一性約束
   - **驗證標準**：
     - deliveries 資料表正確建立
     - 外鍵約束正常運作，可防止無效關聯
     - 唯一性約束防止重複傳送記錄
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證資料表關聯正確。
   - 驗證：UNIQUE(post_id, subscription_id) 約束

---

## ⚙️ 第二階段：核心 API 開發

### 3. Hono 應用基礎架構

7. [ ] **3.1** 建立 Hono 應用，設定基本路由結構

   - **執行步驟**：
     1. 修改 `src/index.ts`，建立 Hono 應用實例
     2. 設定環境類型定義，包含 D1 Database 和 Secrets 綁定
     3. 建立基本路由群組：`/api/*`, `/subscriptions/*`, `/admin/*`, `/tg/*`
     4. 添加 CORS 中間件，允許必要的請求來源
     5. 添加 JSON 解析中間件
     6. 建立統一錯誤處理機制
     7. 測試基本路由回應：`curl http://localhost:8787/health`
   - **驗證標準**：
     - Hono 應用正常啟動，無編譯錯誤
     - 基本路由結構建立完成
     - 中間件順序正確，CORS 設定生效
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證應用啟動正常。
   - 參考：[spec.md - 最小程式骨架](./spec.md#14-最小程式骨架示意)

8. [ ] **3.2** 實作認證中介層（X-API-Key 驗證）

   - **執行步驟**：
     1. 建立 `src/middleware/auth.ts` 中介層檔案
     2. 實作 `validateApiKey` 函數，檢查 X-API-Key header
     3. 與環境變數 `API_KEY` 比對驗證
     4. 回傳 401 Unauthorized 錯誤（如果認證失敗）
     5. 將中介層套用至需要認證的路由群組
     6. 建立測試案例：有效與無效的 API Key
     7. 確保錯誤訊息安全，不洩露系統資訊
   - **驗證標準**：
     - 有效 API Key 可正常通過認證
     - 無效 API Key 回傳 401 錯誤
     - 認證邏輯安全且高效
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證認證邏輯正確。
   - 測試：未授權請求應回傳 401

9. [ ] **3.3** 實作 GET /health 健康檢查端點
   - **執行步驟**：
     1. 建立 `src/handlers/health.ts` 處理程式檔案
     2. 實作健康檢查邏輯，包含：
        - 系統時間戳
        - D1 資料庫連線狀態測試
        - 環境變數載入狀態檢查
     3. 回傳標準化 JSON 格式：`{ status: 'ok', timestamp: ..., database: 'connected' }`
     4. 處理異常情況，回傳適當錯誤狀態
     5. 設定快取標頭（Cache-Control: no-cache）
     6. 測試端點回應：`curl http://localhost:8787/health`
   - **驗證標準**：
     - 健康檢查端點正常回應 200 OK
     - 回應格式符合預期 JSON 結構
     - 資料庫連線狀態正確顯示
   - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證回應格式。
   - 預期回應：`{ ok: true }`

### 4. 資料接收與處理 API

10. [ ] **4.1** 實作 POST /api/ingest 資料驗證邏輯

    - **執行步驟**：
      1. 建立 `src/handlers/ingest.ts` 處理程式檔案
      2. 建立 TypeScript 介面定義請求格式：title, content, url, publishTime
      3. 實作請求內容驗證：
         - 必要欄位檢查（title, content, url）
         - URL 格式驗證（使用正規表達式）
         - 字串長度限制檢查
      4. 實作錯誤回應格式：400 Bad Request 與詳細錯誤訊息
      5. 新增請求日誌記錄，追蹤 API 呼叫狀況
      6. 測試各種無效輸入案例
    - **驗證標準**：
      - 有效請求正常通過驗證
      - 無效請求回傳適當的 400 錯誤
      - 錯誤訊息清楚且有助於除錯
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證輸入格式檢查。
    - 參考：[spec.md - 請求格式](./spec.md#62-請求格式apiingestpost)

11. [ ] **4.2** 實作 posts 資料 UPSERT 機制

    - **執行步驟**：
      1. 建立 `src/services/postService.ts` 服務檔案
      2. 實作 `upsertPost` 函數，使用 SQLite UPSERT 語法
      3. 以 URL 為唯一鍵，實現「存在則更新，不存在則新增」邏輯
      4. 處理時間戳自動設定：created_ts, updated_ts
      5. 回傳操作結果：新增或更新的 post_id
      6. 添加資料庫事務處理，確保資料一致性
      7. 測試相同 URL 的重複提交行為
    - **驗證標準**：
      - 新 URL 成功新增到資料庫
      - 重複 URL 正確更新現有記錄
      - 時間戳正確設定和更新
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 URL 去重邏輯。
    - 測試：相同 URL 應更新而非新增

12. [ ] **4.3** 實作時區轉換與時間戳處理
    - **執行步驟**：
      1. 建立 `src/utils/timeUtils.ts` 工具檔案
      2. 實作 `taiwanToUtc` 函數，將 Asia/Taipei 時間轉為 UTC
      3. 實作 `parsePublishTime` 函數，處理多種輸入格式
      4. 支援 ISO 8601 格式與台灣時間格式輸入
      5. 添加時間戳驗證，拒絕未來時間或過久的歷史時間
      6. 建立單元測試，驗證時區轉換正確性
      7. 處理無效時間格式的錯誤情況
    - **驗證標準**：
      - 台灣時間正確轉換為 UTC 時間戳
      - 支援多種常見時間格式輸入
      - 時間邊界條件正確處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 Asia/Taipei 轉 UTC。
    - 參考：[spec.md - 時區與日期](./spec.md#3-時區與日期)

### 5. 訂閱管理 API

13. [ ] **5.1** 實作 POST /subscriptions 訂閱建立

    - **執行步驟**：
      1. 建立 `src/handlers/subscriptions.ts` 處理程式檔案
      2. 實作請求驗證：chat_id 格式檢查（必須為有效的 Telegram Chat ID）
      3. 產生確認 token：使用 crypto.randomUUID() 或類似安全方法
      4. 設定 token 過期時間：目前時間 + 10 分鐘
      5. 執行 UPSERT 邏輯：更新或建立訂閱記錄
      6. 回傳確認連結格式：`/subscriptions/confirm?token=xxx`
      7. 新增重複訂閱處理邏輯
    - **驗證標準**：
      - 新訂閱成功建立，狀態為 pending
      - confirm_token 正確產生且未過期
      - 重複訂閱請求正確處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證訂閱建立邏輯。
    - 參考：[spec.md - 管理端點](./spec.md#63-管理端點)

14. [ ] **5.2** 實作 GET /subscriptions/:chat_id/status 狀態查詢

    - **執行步驟**：
      1. 實作路由參數驗證：chat_id 格式檢查
      2. 查詢 subscriptions 資料表，取得訂閱狀態
      3. 回傳標準化 JSON 格式：`{ chat_id, status, subscribe_ts, confirm_ts }`
      4. 處理找不到訂閱的情況：回傳 404 Not Found
      5. 添加狀態描述：pending, confirmed, cancelled
      6. 包含確認 token 是否過期的檢查
    - **驗證標準**：
      - 存在的訂閱正確回傳狀態資訊
      - 不存在的訂閱回傳 404 錯誤
      - 狀態資訊完整且準確
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證狀態回應格式。

15. [ ] **5.3** 實作 DELETE /subscriptions/:chat_id 訂閱停用
    - **執行步驟**：
      1. 實作路由參數驗證：chat_id 格式檢查
      2. 查詢現有訂閱記錄，確認存在性
      3. 執行軟刪除：設定 status = 'cancelled', cancelled_ts = current_timestamp
      4. 不實際刪除資料，保留歷史記錄供分析
      5. 回傳操作結果：成功訊息與更新時間戳
      6. 處理重複停用請求（冪等性設計）
    - **驗證標準**：
      - 現有訂閱成功設定為 cancelled 狀態
      - 不存在的訂閱回傳適當錯誤
      - 重複停用請求正確處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證軟刪除邏輯。

---

## 🤖 第三階段：Telegram 互動開發

### 6. Webhook 基礎架構

16. [ ] **6.1** 實作 POST /tg/webhook 端點與安全驗證

    - **執行步驟**：
      1. 建立 `src/handlers/telegram.ts` 處理程式檔案
      2. 實作 Telegram webhook 安全驗證：
         - 檢查 `X-Telegram-Bot-Api-Secret-Token` header
         - 與環境變數 `TELEGRAM_WEBHOOK_SECRET` 比對
      3. 驗證請求來源，確保來自 Telegram 伺服器
      4. 解析 Telegram Update 物件結構
      5. 建立基本回應格式：200 OK 或 401 Unauthorized
      6. 添加請求日誌，記錄 webhook 呼叫狀況
      7. 錯誤處理：惡意請求與格式錯誤
    - **驗證標準**：
      - 有效 Secret 的請求正常通過驗證
      - 無效 Secret 的請求回傳 401 錯誤
      - Telegram Update 物件正確解析
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 Secret Header 檢查。
    - 測試：無效 Secret 應回傳 401

17. [ ] **6.2** 實作 Telegram 訊息解析與分類處理
    - **執行步驟**：
      1. 建立 `src/services/telegramService.ts` 服務檔案
      2. 實作 `parseUpdate` 函數，分析 Update 類型：
         - text message（一般訊息）
         - callback_query（按鈕回調）
         - 其他類型（暫時忽略）
      3. 建立訊息路由器，根據內容分派到不同處理函數
      4. 實作關鍵字識別：/start, /subscribe, "訂閱", "取消訂閱" 等
      5. 處理未知指令，回傳說明訊息
      6. 建立回應訊息格式化工具
    - **驗證標準**：
      - 不同訊息類型正確識別和分類
      - 關鍵字匹配邏輯準確運作
      - 未知指令有適當的回應
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證訊息類型識別。
    - 支援：text message, callback_query

### 7. 關鍵字互動處理

18. [ ] **7.1** 實作 /start 與「開始」指令處理

    - **執行步驟**：
      1. 建立 `src/handlers/commands.ts` 指令處理檔案
      2. 實作 `handleStartCommand` 函數：
         - 檢查用戶是否已訂閱（查詢 subscriptions 資料表）
         - 根據訂閱狀態回傳不同訊息
      3. 設計歡迎訊息格式，包含：
         - 系統功能說明
         - 可用指令列表
         - 訂閱狀態提示
      4. 添加 Inline Keyboard 按鈕：「立即訂閱」、「檢查狀態」
      5. 呼叫 Telegram Bot API 傳送訊息
      6. 記錄用戶互動日誌
    - **驗證標準**：
      - 新用戶收到完整的歡迎訊息
      - 已訂閱用戶收到狀態確認訊息
      - Inline Keyboard 按鈕正確顯示且可點擊
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證狀態回應。
    - 參考：[spec.md - 關鍵字互動](./spec.md#72-telegram-webhook關鍵字互動)

19. [ ] **7.2** 實作「訂閱」與 /subscribe 指令處理

    - **執行步驟**：
      1. 實作 `handleSubscribeCommand` 函數
      2. 檢查現有訂閱狀態：
         - 已確認：回傳「您已訂閱」訊息
         - 待確認：重新發送確認連結
         - 無訂閱：建立新訂閱
      3. 呼叫訂閱建立 API（重用 POST /subscriptions 邏輯）
      4. 產生確認連結，格式：`https://your-domain.com/subscriptions/confirm?token=xxx`
      5. 回傳確認訊息，包含：
         - 訂閱說明
         - 確認連結（可點擊）
         - 時限提醒（10 分鐘內確認）
      6. 設定 token 自動清理機制
    - **驗證標準**：
      - 新訂閱正確建立，狀態為 pending
      - 確認連結格式正確且可存取
      - 重複訂閱請求適當處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證訂閱流程。

20. [ ] **7.3** 實作「確認 <token>」指令處理

    - **執行步驟**：
      1. 實作 `handleConfirmCommand` 函數
      2. 解析訊息中的 token 參數（支援 "確認 abc123" 格式）
      3. 查詢 subscriptions 資料表，驗證 token：
         - token 存在性檢查
         - token 過期時間檢查（confirm_token_expire_ts）
         - 訂閱狀態檢查（避免重複確認）
      4. 執行確認操作：
         - 更新 status = 'confirmed'
         - 設定 confirm_ts = current_timestamp
         - 清除 confirm_token 和過期時間
      5. 回傳確認結果訊息：
         - 成功：「訂閱確認成功！您將收到最新新聞推播。」
         - 失敗：錯誤原因說明
      6. 記錄確認操作日誌
    - **驗證標準**：
      - 有效 token 成功完成訂閱確認
      - 過期或無效 token 回傳適當錯誤訊息
      - 重複確認請求正確處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 token 驗證與過期檢查。

21. [ ] **7.4** 實作「退訂」與 /unsubscribe 指令處理

    - **執行步驟**：
      1. 實作 `handleUnsubscribeCommand` 函數
      2. 檢查現有訂閱狀態：
         - 未訂閱：回傳「您尚未訂閱」訊息
         - 已訂閱：執行退訂流程
      3. 執行軟刪除操作：
         - 更新 status = 'cancelled'
         - 設定 cancelled_ts = current_timestamp
         - 保留歷史記錄
      4. 回傳確認訊息：
         - 成功：「退訂成功！您將不再收到新聞推播。」
         - 附加：重新訂閱方法說明
      5. 添加 Inline Keyboard：「重新訂閱」按鈕
      6. 記錄退訂操作日誌
    - **驗證標準**：
      - 現有訂閱成功退訂
      - 未訂閱用戶收到適當提示
      - 退訂後狀態正確更新
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證訂閱停用邏輯。

22. [ ] **7.5** 實作「狀態」與 /status 指令處理
    - **執行步驟**：
      1. 實作 `handleStatusCommand` 函數
      2. 查詢用戶訂閱狀態（複用 GET /subscriptions/:chat_id/status 邏輯）
      3. 格式化狀態回應訊息：
         - 訂閱狀態：已訂閱/待確認/未訂閱
         - 訂閱時間：subscribe_ts 格式化顯示
         - 確認時間：confirm_ts（如果已確認）
         - 最後更新時間
      4. 根據狀態提供操作建議：
         - 未訂閱：顯示「立即訂閱」按鈕
         - 待確認：提示確認方法和剩餘時間
         - 已訂閱：顯示「退訂」選項
      5. 添加 Inline Keyboard 提供快速操作
    - **驗證標準**：
      - 狀態資訊準確顯示
      - 時間格式正確且易讀
      - 操作建議符合當前狀態
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證狀態資訊顯示。

### 8. 群組管理功能

23. [ ] **8.1** 實作群組管理員身份驗證（getChatMember）

    - **執行步驟**：
      1. 建立 `src/utils/groupUtils.ts` 群組工具檔案
      2. 實作 `checkAdminPermission` 函數：
         - 呼叫 Telegram Bot API `getChatMember`
         - 檢查用戶在群組中的身份：creator, administrator
         - 快取管理員身份（避免重複查詢）
      3. 實作權限檢查中間件，用於群組相關指令
      4. 處理 API 呼叫失敗情況（機器人未加入群組等）
      5. 建立權限錯誤訊息範本
      6. 記錄權限檢查日誌，協助除錯
    - **驗證標準**：
      - 群組管理員正確通過權限檢查
      - 一般成員被拒絕執行管理指令
      - API 錯誤情況適當處理
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證管理員權限檢查。

24. [ ] **8.2** 實作群組專用訊息範本與邏輯
    - **執行步驟**：
      1. 建立群組訊息範本，與私人對話有所區別：
         - 簡化指令說明（避免群組訊息過長）
         - 移除 Inline Keyboard（群組中不適用）
         - 增加群組特有功能說明
      2. 實作群組訊息發送邏輯：
         - 檢查機器人是否有發送權限
         - 使用 reply_to_message_id 回覆原訊息
         - 控制訊息頻率，避免洗版
      3. 建立群組專用指令處理：
         - /start@bot_username 格式支援
         - 管理員專用指令識別
      4. 實作群組訂閱管理（如果需要）
    - **驗證標準**：
      - 群組中訊息格式適當且簡潔
      - 機器人權限正確處理
      - 群組專用功能正常運作
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證群組訊息處理。
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證群組互動流程。

---

## 📤 第四階段：推播系統開發

### 9. 排程與推播核心

25. [ ] **9.1** 實作 scheduled() Cron 處理函式

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證排程觸發機制。
    - 設定：每小時整點執行 `0 * * * *`

26. [ ] **9.2** 實作未發布貼文查詢與排序

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證查詢條件與順序。
    - 條件：published=0, 依 post_date_ts 排序

27. [ ] **9.3** 實作 filters_json 條件篩選邏輯
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證過濾器運算。
    - 支援：usernames 陣列篩選

### 10. Telegram 訊息發送

28. [ ] **10.1** 實作 sendMessage API 呼叫與 HTML 格式化

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證訊息格式。
    - 參考：[spec.md - Telegram 訊息格式](./spec.md#9-telegram-訊息格式)

29. [ ] **10.2** 實作 deliveries 記錄寫入邏輯

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證投遞狀態追蹤。

30. [ ] **10.3** 實作 published 狀態判斷與更新
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證發布完成邏輯。
    - 條件：所有 enabled=1 訂閱皆 sent

### 11. 速率限制與重試

31. [ ] **11.1** 實作全域速率限制（~25 訊息/秒）

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證節流機制。

32. [ ] **11.2** 實作 429/retry_after 處理與指數退避

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證重試邏輯。
    - 參考：[spec.md - 推播與排程](./spec.md#8-推播與排程)

33. [ ] **11.3** 實作單一聊天速率限制（1 訊息/秒）
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 chat 級別限制。

---

## 🛡️ 第五階段：錯誤處理與安全

### 12. 錯誤處理機制

34. [ ] **12.1** 實作外部 I/O 重試包裝（3 次，指數退避）

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證重試行為。

35. [ ] **12.2** 實作錯誤記錄系統（deliveries.error, posts.last_error）

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證錯誤資訊儲存。

36. [ ] **12.3** 實作失敗投遞自動重試邏輯
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證重試直到成功或停用。

### 13. 安全與日誌

37. [ ] **13.1** 實作結構化 JSON 日誌系統

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證日誌內容完整性。
    - 記錄：post_id, chat_id, HTTP 狀態, 執行耗時

38. [ ] **13.2** 實作輸入大小限制（results ≤ 100）

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證請求大小檢查。

39. [ ] **13.3** 實作 URL 白名單機制（可選功能）
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證網域限制功能。

---

## 🧪 第六階段：管理功能與測試

### 14. 管理功能

40. [ ] **14.1** 實作 POST /admin/push 手動推播功能

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證手動觸發機制。

41. [ ] **14.2** 實作 dry_run=1 模式（試跑不實際發送）
    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證預覽模式正確性。

### 15. 系統測試

42. [ ] **15.1** Webhook 安全性測試（無效 Secret 回 401）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證安全機制。

43. [ ] **15.2** 訂閱確認流程完整測試（token 產生 → 驗證 → 狀態變更）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證完整流程。

44. [ ] **15.3** UPSERT 行為測試（相同 URL 更新不重複）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證去重邏輯。

45. [ ] **15.4** 推播與 published 標記測試

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證發布狀態更新。

46. [ ] **15.5** 速率限制與重試測試（429 處理）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證限流與退避機制。

47. [ ] **15.6** 關鍵字互動完整測試（所有指令）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證互動邏輯正確。

48. [ ] **15.7** 群組管理員權限測試
    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證權限檢查機制。

---

## 🚀 第七階段：部署與驗收

### 16. 部署作業

49. [ ] **16.1** 設定 Telegram Webhook（setWebhook 至 Workers URL）

    - 請以繁體中文於程式中添加詳細流程說明與註解，並驗證 Webhook 設定成功。
    - 參考：[spec.md - 設定 Webhook](./spec.md#76-設定-webhook)

50. [ ] **16.2** 生產環境部署與環境變數確認
    - 請以繁體中文於部署腳本中添加詳細流程說明與註解，並驗證部署成功。
    - 執行：`wrangler deploy`

### 17. 驗收測試

51. [ ] **17.1** 端到端流程測試（Producer → API → 推播 → 用戶接收）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證完整業務流程。

52. [ ] **17.2** 效能測試（100 條貼文 ingest ≤ 1s 平均延遲）

    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證效能要求。

53. [ ] **17.3** 可用性測試（Cron 冪等性、失敗重試）
    - 請以繁體中文於測試程式中添加詳細流程說明與註解，並驗證系統穩定性。

---

## 📋 進度追蹤

**完成狀態**：`0/53` 任務完成

**各階段進度**：

- 🏗️ 第一階段（環境建置）：`0/6` 完成
- ⚙️ 第二階段（核心 API）：`0/9` 完成
- 🤖 第三階段（Telegram 互動）：`0/9` 完成
- 📤 第四階段（推播系統）：`0/9` 完成
- 🛡️ 第五階段（錯誤處理與安全）：`0/6` 完成
- 🧪 第六階段（管理功能與測試）：`0/8` 完成
- 🚀 第七階段（部署與驗收）：`0/6` 完成

---

💡 **開發建議**：建議依序執行各階段任務，每完成一個階段進行簡單測試，確保功能正確後再進入下一階段。
