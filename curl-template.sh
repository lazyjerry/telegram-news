#!/bin/bash

# ===========================================
# Telegram News API - cURL 範本腳本
# ===========================================

# 配置區域 - 請修改以下變數
API_KEY="YOUR_API_KEY_HERE"
API_URL="https://telegram-news.jlib-cf.workers.dev/api/ingest"

# 基本測試範例
echo "=== 基本單一新聞推送 ==="
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "date": "2025-01-15",
    "results": [
      {
        "username": "tech_news",
        "start": "2025-01-15",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "AI 技術新突破：GPT-5 正式發布，帶來更強大的語言理解能力",
            "url": "https://example.com/ai-news-gpt5",
            "get_date": "2025-01-15"
          }
        ]
      }
    ]
  }'

echo -e "\n\n=== 多新聞批次推送 ==="
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "date": "2025-01-15",
    "results": [
      {
        "username": "tech_news",
        "start": "2025-01-15",
        "end": "2025-01-16",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "AI 技術新突破：GPT-5 正式發布",
            "url": "https://example.com/ai-news-gpt5",
            "get_date": "2025-01-15"
          },
          {
            "post_date": "2025-01-15",
            "summary": "量子計算重大進展：新型量子處理器問世",
            "url": "https://example.com/quantum-computing",
            "get_date": "2025-01-15"
          },
          {
            "post_date": "2025-01-15",
            "summary": "區塊鏈技術應用擴展：金融業採用率創新高",
            "url": "https://example.com/blockchain-finance",
            "get_date": "2025-01-15"
          }
        ]
      },
      {
        "username": "finance_updates",
        "start": "2025-01-15",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "全球股市收盤報告：科技股領漲，市場情緒樂觀",
            "url": "https://example.com/stock-market-report",
            "get_date": "2025-01-15"
          }
        ]
      }
    ]
  }'

echo -e "\n\n=== 詳細輸出版本（包含狀態碼和回應標頭）==="
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -w "\n\n--- 回應資訊 ---\nHTTP 狀態碼: %{http_code}\n回應時間: %{time_total}s\n" \
  -v \
  -d '{
    "date": "2025-01-15",
    "results": [
      {
        "username": "breaking_news",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "緊急新聞：重要政策發布，影響全球經濟走向",
            "url": "https://example.com/breaking-economic-policy",
            "get_date": "2025-01-15"
          }
        ]
      }
    ]
  }'

echo -e "\n\n=== 從檔案讀取資料 ==="
echo "# 您可以將 JSON 資料儲存到檔案中，然後使用 @filename 語法："
echo "curl -X POST '$API_URL' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'X-API-Key: $API_KEY' \\"
echo "  -d @news-data.json"

echo -e "\n\n=== 靜默模式（僅顯示回應內容）==="
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "date": "2025-01-15",
    "results": [
      {
        "username": "quick_test",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "測試新聞摘要",
            "url": "https://example.com/test-news",
            "get_date": "2025-01-15"
          }
        ]
      }
    ]
  }' | jq '.'

echo -e "\n\n=== 錯誤測試（無效的 API Key）==="
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: INVALID_KEY" \
  -w "\nHTTP 狀態碼: %{http_code}\n" \
  -d '{
    "date": "2025-01-15",
    "results": [
      {
        "username": "test_user",
        "posts": [
          {
            "post_date": "2025-01-15",
            "summary": "測試新聞",
            "url": "https://example.com/test",
            "get_date": "2025-01-15"
          }
        ]
      }
    ]
  }'
