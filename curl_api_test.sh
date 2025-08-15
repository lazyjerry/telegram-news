#!/bin/bash
# 呼叫 /api/test 端點的 curl 指令範例

# 方式 1: 基本 curl 指令
echo "🚀 基本 curl 指令:"
echo 'curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  https://telegram-news.jlib-cf.workers.dev/api/test'

echo ""
echo "📋 實際執行範例 (請替換 YOUR_API_KEY_HERE):"
echo 'curl -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY_HERE" \
  https://telegram-news.jlib-cf.workers.dev/api/test | jq'

echo ""
echo "🔧 一行式指令:"
echo 'curl -X POST -H "Content-Type: application/json" -H "X-API-Key: YOUR_API_KEY_HERE" https://telegram-news.jlib-cf.workers.dev/api/test | jq'

echo ""
echo "⚠️  注意事項:"
echo "1. 請將 YOUR_API_KEY_HERE 替換為實際的 API 金鑰"
echo "2. 可以使用 'wrangler secret list' 查看已設定的密鑰"
echo "3. 添加 '| jq' 可以格式化 JSON 回應 (需要安裝 jq)"
echo "4. 如果沒有 jq，移除 '| jq' 部分即可"

echo ""
echo "📊 預期回應格式:"
cat << 'EOF'
{
  "ok": true,
  "message": "推播任務執行完成",
  "execution_time": 1234,
  "stats": {
    "processed_posts": 0,
    "total_messages": 0,
    "successful_sends": 0,
    "failed_sends": 0,
    "skipped_posts": 0,
    "execution_time": 1234
  },
  "timestamp": "2025-08-15T14:30:00.000Z"
}
EOF
