# Telegram News Bot - 變更日誌

## [0.4.0] - 2025 年第四階段完成 - 推播系統開發

### 新增功能 ✨

- **資料接收與處理系統**：實現完整的外部資料接收機制

  - 實作 `POST /api/ingest` 端點，支援新聞資料批次接收
  - 建立 `PostService` 服務，提供完整的 UPSERT 功能
  - 建立 `timeUtils` 工具，支援多種時間格式和 Asia/Taipei 時區轉換
  - 支援 URL 去重邏輯，自動處理重複新聞更新

- **定時推播系統**：實現完整的新聞推播排程功能

  - 實作 `CronHandler` 類別，處理每小時的自動推播
  - 建立 `BroadcastService` 服務，管理推播邏輯和用戶篩選
  - 整合 Cloudflare Workers 排程功能（每小時執行：`0 * * * *`）

- **Telegram API 整合**：完整的訊息傳送系統

  - 實作 `TelegramApiService` 類別，處理 Bot API 呼叫
  - 支援 HTML 格式的新聞訊息排版
  - 實現投遞記錄追蹤和狀態更新

- **速率限制系統**：符合 Telegram API 限制的智慧節流

  - 建立 `RateLimiterManager` 工具類，採用 Token Bucket 算法
  - 全域速率限制：25 訊息/秒
  - 單一聊天限制：1 訊息/秒
  - 智慧記憶體管理，自動清理非活躍限制器

- **推播邏輯完整化**：
  - 自動查詢未發布的貼文（`published = 0`）
  - 根據訂閱設定進行用戶篩選
  - 支援 `filters_json` 條件篩選功能
  - 發布完成狀態自動更新機制

### 技術改進 🔧

- **錯誤處理加強**：

  - 實作 429 Rate Limit 回應處理
  - 指數退避重試機制
  - 完整的投遞失敗記錄

- **資料庫操作最佳化**：

  - 批次查詢未發布貼文
  - 高效的訂閱篩選邏輯
  - 投遞記錄批次寫入

- **型別安全提升**：
  - 完整的 TypeScript 介面定義
  - 嚴格的 null 檢查和型別保護
  - D1 資料庫查詢結果型別強化

### 基礎設施 🏗️

- **生產環境部署**：

  - Cloudflare Workers 完整配置
  - D1 資料庫 schema 遷移完成
  - 環境變數和機密設定完成
  - Bot Token 驗證和啟用

- **程式架構**：
  - 服務層模式實作（Services Layer Pattern）
  - 關注點分離設計
  - 可測試和可維護的代碼結構

### API 端點 📡

- **推播觸發**：透過 scheduled event 自動執行
- **Bot 整合**：`/getMe` API 驗證完成
- **投遞追蹤**：完整的狀態記錄系統

### 檔案結構變更 📁

```
src/
├── handlers/
│   ├── cronHandler.ts          # 定時任務處理器
│   └── ingest.ts               # 資料接收端點處理器
├── services/
│   ├── broadcastService.ts     # 推播業務邏輯
│   ├── postService.ts          # 貼文管理服務（UPSERT 邏輯）
│   └── telegramApi.ts          # Telegram API 服務
└── utils/
    ├── rateLimiter.ts          # 速率限制工具
    └── timeUtils.ts            # 時間處理工具（時區轉換）
```

### API 端點更新 📡

- **POST /api/ingest**：新聞資料接收端點（支援批次 UPSERT）
- **推播觸發**：透過 scheduled event 自動執行

```
src/
├── handlers/
│   └── cronHandler.ts          # 定時任務處理器
├── services/
│   ├── broadcastService.ts     # 推播業務邏輯
│   └── telegramApi.ts          # Telegram API 服務
└── utils/
    └── rateLimiter.ts          # 速率限制工具
```

### 部署資訊 🚀

- **部署 URL**：https://telegram-news.jlib-cf.workers.dev/
- **Cron 排程**：每小時執行一次（`0 * * * *`）
- **Bot 資訊**：@this_news_bot (ID: 8324527043)

### 驗證測試 ✅

- [x] Bot Token 有效性驗證
- [x] 排程觸發機制測試
- [x] 速率限制功能驗證
- [x] 資料庫連線和查詢測試
- [x] 生產環境部署成功

---

## [0.3.0] - 第三階段完成 - 訂閱管理系統

### 新增功能 ✨

- 完整的訂閱管理 CRUD API
- 用戶偏好設定功能
- 篩選條件支援

---

## [0.2.0] - 第二階段完成 - 核心 API

### 新增功能 ✨

- 完整的貼文管理 API
- 資料驗證和錯誤處理
- RESTful API 設計

---

## [0.1.0] - 第一階段完成 - 專案建置

### 新增功能 ✨

- 專案初始化和環境設定
- Cloudflare Workers 配置
- D1 資料庫架構建立
- 基礎開發環境準備

---

**圖例**：

- ✨ 新增功能
- 🔧 技術改進
- 🐛 錯誤修復
- 🏗️ 基礎設施
- 📡 API 變更
- 📁 檔案結構
- 🚀 部署相關
- ✅ 驗證測試
