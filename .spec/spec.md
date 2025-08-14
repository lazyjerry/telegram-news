# 技術參考文件與程式骨架（Technical Reference & Code Skeleton）

> 本文件為系統的技術實作參考，包含架構、資料庫設計、API 規格、環境設定、程式骨架等。
>
> 完整業務規格請參閱：
>
> - 前端規格：[front-spec.md](./front-spec.md)
> - 後端規格：[back-spec.md](./back-spec.md)
> - 需求總覽：[requirement.md](./requirement.md)

## 1) 系統目標

- 以 Hono 建置一個部署於 Cloudflare Workers 的後端。
- 提供 API 將新聞貼文資料寫入 D1。
- 每小時自動抓取 D1 中「未發布」的內容，推送到已訂閱的聊天（用戶或群組），成功後標記為已發布。

## 2) 架構

- **Client/Producer**：外部服務呼叫 API 丟入資料。
- **Worker API (Hono)**：接收資料、驗證、寫入 D1。
- **D1 (SQLite)**：儲存貼文、訂閱、投遞紀錄。
- **Telegram Bot API**：實際發送訊息。
- **Cron Trigger**：每小時觸發 `scheduled()` 執行推播。

流程：Producer → POST /api/ingest → D1(posts) → Cron → 依 subscriptions 送出訊息 → 記錄 deliveries → 全部送達後將 posts.published=1。

## 3) 時區與日期

- API 與資料欄位日期皆採 ISO **YYYY-MM-DD**。
- Worker 執行環境為 UTC。顯示與比較時以 **Asia/Taipei (UTC+8)** 轉換再儲存文字日期欄。
- 同步保存 `*_ts INTEGER`（Unix 秒，UTC）以利排序與查詢。

## 4) 環境與綁定

- `TELEGRAM_BOT_TOKEN`：Bot Token（Secrets）。
- `API_KEY`：私有 API 金鑰（Secrets）。
- `TELEGRAM_WEBHOOK_SECRET`：Telegram Webhook 驗證用 Shared Secret（Secrets，可選但建議）。
- `DB`：D1 Binding 名稱。
- Wrangler 綁定與定時觸發：

```jsonc
// wrangler.jsonc
{
	"name": "telegram-news",
	"main": "src/index.ts",
	"compatibility_date": "2025-08-14",
	"triggers": {
		"crons": ["0 * * * *"] // 每小時
	},
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "telegram_news_db",
			"database_id": "<your-d1-id>"
		}
	]
}
```

> 參考：Cloudflare Cron Triggers（`0 * * * *` 代表整點每小時一次），D1 綁定與使用。

## 5) 資料庫設計（D1 / SQLite）

### 5.1 資料表

```sql
-- 貼文
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_username TEXT NOT NULL,
  start_date TEXT,            -- YYYY-MM-DD（Asia/Taipei）
  end_date TEXT,              -- YYYY-MM-DD（Asia/Taipei）
  post_date TEXT NOT NULL,    -- YYYY-MM-DD（Asia/Taipei）
  post_date_ts INTEGER,       -- UTC Unix 秒
  summary TEXT NOT NULL,
  url TEXT NOT NULL,
  get_date TEXT NOT NULL,     -- YYYY-MM-DD（Asia/Taipei）
  get_date_ts INTEGER,        -- UTC Unix 秒
  published INTEGER NOT NULL DEFAULT 0,
  published_at_ts INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at_ts INTEGER NOT NULL,
  updated_at_ts INTEGER NOT NULL,
  UNIQUE(url)
);

-- 訂閱者（用戶或群組）
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,      -- 例如：個人正整數；群組為負整數
  enabled INTEGER NOT NULL DEFAULT 1,
  confirmed INTEGER NOT NULL DEFAULT 0, -- 是否已完成確認
  confirm_token TEXT,                   -- 送出確認時產生的一次性 token
  confirm_token_expire_ts INTEGER,     -- token 到期時間（UTC 秒）
  confirmed_at_ts INTEGER,              -- 確認時間（UTC 秒）
  -- 過濾條件（JSON）：{"usernames":["foo","bar"]}，空或 NULL 代表全量
  filters_json TEXT,
  created_at_ts INTEGER NOT NULL,
  updated_at_ts INTEGER NOT NULL,
  UNIQUE(chat_id)
);

-- 投遞紀錄（每一貼文對每一訂閱一筆）
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  subscription_id INTEGER NOT NULL,
  status TEXT NOT NULL,           -- 'sent' | 'failed'
  telegram_message_id TEXT,
  error TEXT,
  sent_at_ts INTEGER,
  created_at_ts INTEGER NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  UNIQUE(post_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published, post_date_ts);
CREATE INDEX IF NOT EXISTS idx_deliveries_post ON deliveries(post_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_enabled ON subscriptions(enabled);
CREATE INDEX IF NOT EXISTS idx_subscriptions_confirmed ON subscriptions(confirmed);
CREATE INDEX IF NOT EXISTS idx_subscriptions_confirm_token ON subscriptions(confirm_token);
```

### 5.2 發布完成的判定

- 一篇貼文需對「當下所有 `enabled=1` 的訂閱」皆 `sent` 才將 `posts.published=1` 與 `published_at_ts=now()`。

## 6) API 設計（Hono）

### 6.1 安全

- Header：`X-API-Key: <API_KEY>` 必填。
- Content-Type：`application/json`。

### 6.2 請求格式（/api/ingest，POST）

- Body 格式（外部 Producer 提供）：

```json
{
	"date": "{TODAY}",
	"results": [
		{
			"username": "{username}",
			"start": "{START_DATE}",
			"end": "{END_DATE}",
			"posts": [
				{
					"post_date": "{post_date}",
					"summary": "{summary}",
					"url": "{post_url}",
					"get_date": "{get_date}"
				}
			]
		}
	]
}
```

- 驗證規則：

  - `date/start/end/post_date/get_date` 皆 `YYYY-MM-DD`。
  - `username`、`summary`、`url` 必填。
  - 以 `url` 為去重鍵。若已存在則執行 UPSERT（更新 `summary` 與日期欄位，保留舊的 `published` 狀態）。

### 6.3 管理端點

**POST /subscriptions**（需 `X-API-Key`）

- Body：`{ "chat_id": "<string>", "filters": { "usernames": ["foo","bar"] } }`
- 行為：建立或更新 `subscriptions` 為 `enabled=1, confirmed=0`，產生 `confirm_token`
- 回應：`{ ok: true, subscription_id, confirmed: false }`

**GET /subscriptions/:chat_id/status**（需 `X-API-Key`）

- 回應：`{ ok: true, enabled, confirmed, filters_json, created_at_ts, confirmed_at_ts }`

**DELETE /subscriptions/:chat_id**（需 `X-API-Key`）

- 行為：將 `enabled=0`（保留紀錄）
- 回應：`{ ok: true }`

**POST /admin/push**（需 `X-API-Key`）

- Query：`?dry_run=1`（可選）
- 行為：手動觸發推播，dry_run 模式不產生實際投遞
- 回應：`{ ok: true, posts_processed, deliveries_planned, deliveries_sent }`

**GET /health**

- 無需認證
- 回應：`{ ok: true }`

## 7) 訂閱與確認流程

- 目的：僅向「已確認」且 `enabled=1` 的訂閱對象推送，避免垃圾訊息。

### 7.1 端點

- `POST /subscriptions`（需 `X-API-Key`）

  - Body：`{ "chat_id": "<string>", "filters": { "usernames": ["foo","bar"] } }`
  - 行為：建立或更新 `subscriptions` 為 `enabled=1, confirmed=0`，產生 `confirm_token`，並以 Telegram 送出「確認訂閱」訊息（含 InlineKeyboard）。
  - 回應：`{ ok: true, subscription_id, confirmed: false }`

- `GET /subscriptions/:chat_id/status`（需 `X-API-Key`）：回傳 `enabled/confirmed/filters_json` 與時間戳。

- `DELETE /subscriptions/:chat_id`（需 `X-API-Key`）：將 `enabled=0`（保留紀錄）。

### 7.2 Telegram Webhook（關鍵字互動）

- 入口：`POST /tg/webhook`，必須驗證 Header `X-Telegram-Bot-Api-Secret-Token` 等於 `TELEGRAM_WEBHOOK_SECRET`。
- 私聊與群組皆支援，下列關鍵字大小寫不敏感；群組僅處理由群組管理員發出的管理指令。

處理規則：

1. **`/start` 或 `開始`**
   - 回覆當前訂閱狀態（enabled/confirmed 與 filters），並提示可用指令：`訂閱`、`退訂`、`狀態`。
2. **`訂閱` 或 `/subscribe`**
   - 若無訂閱紀錄：建立 `subscriptions`（`chat_id` 取自訊息來源），設定 `enabled=1, confirmed=0`。
   - 產生 `confirm_token` 與 `confirm_token_expire_ts=now()+600s`。
   - 回覆提示：`請回覆：確認 <token>（10 分鐘內有效）`。
3. **`確認 <token>`**
   - 驗證該 `chat_id` 的 `confirm_token` 與有效期；通過則：`confirmed=1`、寫入 `confirmed_at_ts=now()`、清空 `confirm_token/confirm_token_expire_ts`。
   - 回覆：`訂閱已啟用`，並顯示當前 `filters`。
4. **`退訂` 或 `/unsubscribe`**
   - 將 `enabled=0`；回覆：`已停用推播。可輸入「訂閱」重新啟用。`
5. **`狀態` 或 `/status`**
   - 回覆目前狀態與最近一次推播時間（若可得）。
6. **群組限制**
   - 僅接受群組管理員的 `訂閱/退訂/狀態` 指令（以 Telegram `getChatMember` 判定；可選）。

舊版 callback_query 處理（保留）：

- 當收到 `callback_query.data`：
  - `confirm:<token>` → 驗證 `confirm_token` 後，將 `confirmed=1`、寫入 `confirmed_at_ts=now()`、清空 `confirm_token`，回覆「訂閱已啟用」。
  - `cancel:<token>` → 將 `enabled=0` 或保留未確認狀態，回覆「已取消」。

### 7.3 訊息範本（確認用與互動回應）

**關鍵字互動回應範本**：

- 訂閱提示：`你正在訂閱推播。請在 10 分鐘內回覆：「確認 <token>」。若不同意，輸入「取消」或忽略此訊息。`
- 訂閱成功：`訂閱已啟用。可用指令：狀態、退訂。`
- 退訂成功：`已停用推播。可輸入「訂閱」重新啟用。`
- Token 過期：`驗證碼已過期。請輸入「訂閱」以取得新的驗證碼。`
- 狀態查詢：顯示目前訂閱狀態（enabled/confirmed）與 filters 設定，以及最近一次推播時間（若可得）

**InlineKeyboard 範本**（舊版支援）：

- 文字：`請確認訂閱。若同意接收推播，請點擊下方按鈕。`
- InlineKeyboard：`[[{"text":"確認訂閱","callback_data":"confirm:<token>"}], [{"text":"取消","callback_data":"cancel:<token>"}]]`

### 7.4 Token 規則

- 長度 ≥ 16 的隨機字串（Base64URL 或 HEX）
- 有效期預設 10 分鐘（可於環境變數調整）
- 每次產生新 token 會使舊 token 失效

### 7.5 人機互動流程（範例）

**私聊訂閱**

1. 用戶 → Bot：`/start`
2. Bot → 用戶：顯示當前狀態與提示 `輸入「訂閱」以啟用`
3. 用戶 → Bot：`訂閱`
4. Bot 產生 token，記錄至 `subscriptions.confirm_token`，→ 用戶：`請回覆：確認 <token>`
5. 用戶 → Bot：`確認 <token>`（10 分鐘內）
6. Bot 驗證成功，將 `confirmed=1`，→ 用戶：`訂閱已啟用`

**群組訂閱（需管理員）**

1. 管理員在群組 → Bot：`/subscribe`
2. Bot 產生 token，回覆群組：`請由管理員回覆：確認 <token>`
3. 管理員 → Bot：`確認 <token>`
4. Bot 驗證成功，將該群組 `confirmed=1`，→ 群組：`已啟用群組推播`

**退訂**

- 用戶或群組管理員 → Bot：`退訂` → Bot：`已停用推播`

### 7.6 設定 Webhook

- 以 Bot Token 設定：`setWebhook` 指向 `https://<your-worker>/tg/webhook`，並附帶 `secret_token=TELEGRAM_WEBHOOK_SECRET`。

## 8) 推播與排程

- Wrangler Cron：`0 * * * *` 整點觸發 `scheduled()`。
- 主要步驟：

  1. 查詢 `posts.published=0`，依 `post_date_ts` 由舊到新。
  2. 抓取 `enabled=1` 的 `subscriptions`。
  3. 逐一計算是否通過 filters（如 filters_json.usernames）。
  4. 送出 Telegram 訊息；寫入或更新 `deliveries`。
  5. 若該貼文對所有 `enabled` 訂閱皆 `sent`，設定 `published=1`。

- 速率限制與退避：
  - 全域 ~30 訊息/秒；單一聊天 ≤1 訊息/秒；群組 ≤20/分鐘。
  - 實作節流：
    - 對不同 `chat_id` 的併發送出時，控制全域節流至 ~25/秒。
    - 同一 `chat_id` 至少間隔 1 秒。
    - 收到 429 時讀取 `retry_after`，對該 chat 暫停相應秒數；對全域超過時全域退避（指數回退 1s,2s,4s... 上限 30s）。

## 9) Telegram 訊息格式

- API：`sendMessage`，`parse_mode=HTML`。
- 文字範本：

```
<b>{source_username}</b> • {post_date}
{summary}

🔗 <a href="{url}">連結</a>
```

- 必要權限：將 Bot 加入群組或私聊，取得 `chat_id` 後建立 `subscriptions`。

## 10) 錯誤處理與重試

- 所有外部 I/O 包裝重試（3 次，指數退避）。
- 失敗記錄於 `deliveries.error`，並累加 `posts.attempt_count`、更新 `last_error`。
- `deliveries.status='failed'` 的項目，之後排程會再嘗試，直到 `sent` 或手動停用該訂閱。

## 11) 安全與稽核

- 僅 `X-API-Key` 允許寫入。
- 日誌：所有管理端點與排程寫 JSON log（含 post_id、chat_id、HTTP 狀態、耗時）。
- URL 白名單（可選）：限制 `url` 的來源網域。

## 12) 要求規格

### 12.1 功能性

1. 提供 `/api/ingest` 以接收指定 JSON 結構並寫入 D1，`url` 為去重鍵，重複則 UPSERT。
2. 僅向 `enabled=1 AND confirmed=1` 的訂閱推播；全部成功後才將貼文標記 `published=1`。
3. 支援管理端 `/admin/push?dry_run=1` 進行人工試跑；提供訂閱管理端點（建立、查詢、停用）。
4. 提供 `/tg/webhook` 接收 Telegram 更新並處理確認／取消；驗證 Secret Header。
5. 所有日期以 `YYYY-MM-DD`（Asia/Taipei）存於文字欄，並同步存 `*_ts`（UTC Unix 秒）。

### 12.2 非功能性

1. 安全：`X-API-Key`、Webhook Secret、產線關閉不必要端點；輸入驗證與大小限制（建議單請求 `results` ≤ 100 條）。
2. 可用性：Cron 每小時執行，具冪等；失敗可重試且不重複投遞。
3. 效能：在 100 條貼文的 ingest 下，平均 API 延遲 ≤ 1s（99p ≤ 3s）。
4. 穩定性：遇到 429/5xx 實作指數退避與最大 3 次重試；錯誤完整記錄。
5. 可觀測性：重要操作輸出結構化 JSON 日誌（含 post_id、chat_id、狀態、耗時）。

## 13) 驗收規格

1. **Webhook 安全**：向 `/tg/webhook` 發送無效 `X-Telegram-Bot-Api-Secret-Token` 時回 401；有效時回 200。
2. **訂閱確認**：
   - 透過 `POST /subscriptions` 建立待確認訂閱後，Telegram 端收到含「確認訂閱」按鈕的訊息；點擊後資料庫 `subscriptions.confirmed=1` 並寫入 `confirmed_at_ts`。
   - `GET /subscriptions/:chat_id/status` 回應顯示 `enabled=1, confirmed=1`。
3. **資料寫入**：向 `/api/ingest` 提交範例 JSON，`posts` 成功插入；再次提交相同 `url` 僅更新，不新增重複列。
4. **推播與標記**：在至少一個已確認訂閱下，觸發 Cron 或 `POST /admin/push` 後：
   - 對目標 chat 成功送出訊息並建立 `deliveries` 記錄。
   - 所有啟用且已確認的訂閱皆 `sent` 後，將該貼文 `published=1`。
5. **Dry Run**：`/admin/push?dry_run=1` 回報本次預計推送貼文數與目標聊天數；不產生 `deliveries`、不改 `published`。
6. **節流與重試**：模擬 Telegram 回 `429 retry_after=2` 時，對應 chat 延後至少 2 秒再送；最多重試 3 次，之後將狀態標記為 `failed` 並寫入 `error`。
7. **健康檢查**：`GET /health` 回 `{ ok: true }`。

## 14) 最小程式骨架（示意）

```ts
import { Hono } from "hono";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// 認證中介層
app.use("*", async (c, next) => {
	if (c.req.path.startsWith("/health")) return next();
	if (c.req.header("X-API-Key") !== c.env.API_KEY) return c.json({ ok: false, error: "unauthorized" }, 401);
	await next();
});

// Ingest
app.post("/api/ingest", async (c) => {
	const body = await c.req.json();
	// validate... upsert into D1 via c.env.DB
	return c.json({ ok: true, inserted: 0, updated: 0, skipped: 0 });
});

// Health
app.get("/health", (c) => c.json({ ok: true }));

// Cron 入口
export default {
	fetch: app.fetch,
	scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		// 取未發布 → 依訂閱推送 → 更新 deliveries/posts
	},
};
```

## 15) 參考文件

- Telegram setWebhook 與 Webhook Secret： https://core.telegram.org/bots/webhooks
- Telegram CallbackQuery / InlineKeyboard： https://core.telegram.org/bots/api#inlinekeyboardmarkup
- Webhook Secret Header（X-Telegram-Bot-Api-Secret-Token）： https://core.telegram.org/bots/webhooks#securing-your-webhooks
- Cloudflare Workers Cron Triggers 與 `scheduled()` handler：
  - https://developers.cloudflare.com/workers/configuration/cron-triggers/
  - https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
- Wrangler Cron 設定範例：
  - https://developers.cloudflare.com/workers/examples/cron-trigger/
- D1 文件與 SQL 相容性：
  - https://developers.cloudflare.com/d1/
  - https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Hono on Cloudflare Workers：
  - https://hono.dev/docs/getting-started/cloudflare-workers
  - https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
- Telegram Bot API 與速率限制：
  - https://core.telegram.org/bots/api
  - https://core.telegram.org/bots/faq

---

**備註**

- 如需更嚴格的去重，可改用 `(source_username, url)` 為 UNIQUE。
- 未來可在 `filters_json` 擴充關鍵字或來源站別過濾。
