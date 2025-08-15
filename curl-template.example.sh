#!/bin/bash

# ===========================================
# Telegram News API - cURL 範本腳本
# ===========================================

# 配置區域 - 請修改以下變數
API_KEY="請換為您的 API 金鑰"
API_URL="https://您的子網域.workers.dev/api/ingest"

# 基本測試範例
echo "=== 基本單一新聞推送 ==="
echo "=== 多新聞批次推送（單一 API 呼叫） ==="
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
      "username": "tech_updates",
      "posts": [
        {
        "post_date": "2025-01-15",
        "summary": "新款處理器效能提升30%，耗電量降低50%",
        "url": "https://example.com/tech-news-$(date +%s)",
        "get_date": "2025-01-15"
        },
        {
        "post_date": "2025-01-15",
        "summary": "全球首款可折疊電子紙設備發布，續航達到一週",
        "url": "https://example.com/foldable-eink-$(date +%N | cut -c1-5)",
        "get_date": "2025-01-15"
        }
      ]
      },
      {
      "username": "finance_news",
      "posts": [
        {
        "post_date": "2025-01-15",
        "summary": "虛擬貨幣市場波動加劇，分析師預測將有重大調整",
        "url": "https://example.com/crypto-$(shuf -i 1000-9999 -n 1)",
        "get_date": "2025-01-15"
        },
        {
        "post_date": "2025-01-15",
        "summary": "全球供應鏈改善，多個產業庫存壓力減輕",
        "url": "https://example.com/supply-chain-$RANDOM",
        "get_date": "2025-01-15"
        }
      ]
      },
      {
      "username": "science_daily",
      "posts": [
        {
        "post_date": "2025-01-15",
        "summary": "科學家發現新型可生物降解材料，有望替代塑膠",
        "url": "https://example.com/science-discovery-$(date +%s%N | md5sum | head -c 6)",
        "get_date": "2025-01-15"
        }
      ]
      }
    ]
  }' | jq '.'
