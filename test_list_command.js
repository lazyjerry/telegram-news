/**
 * 測試 /list 指令的 Telegram webhook 模擬請求
 */

const WEBHOOK_SECRET = 'test-webhook-secret-123';
const BASE_URL = 'http://localhost:8787';

async function testListCommand() {
  console.log('🔍 測試 /list 指令功能...\n');

  // 模擬 Telegram webhook 請求數據
  const webhookData = {
    "update_id": 123456789,
    "message": {
      "message_id": 100,
      "from": {
        "id": 12345678,
        "is_bot": false,
        "first_name": "測試用戶",
        "username": "test_user",
        "language_code": "zh-tw"
      },
      "chat": {
        "id": 12345678,
        "first_name": "測試用戶",
        "username": "test_user",
        "type": "private"
      },
      "date": Math.floor(Date.now() / 1000),
      "text": "/list"
    }
  };

  try {
    console.log('📤 發送 /list 指令請求...');
    
    const response = await fetch(`${BASE_URL}/tg/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': WEBHOOK_SECRET
      },
      body: JSON.stringify(webhookData)
    });

    const result = await response.json();
    
    console.log('📥 Webhook 回應:');
    console.log('狀態碼:', response.status);
    console.log('回應內容:', JSON.stringify(result, null, 2));

    if (result.ok) {
      console.log('✅ /list 指令處理成功！');
    } else {
      console.log('❌ /list 指令處理失敗:', result.error);
    }

  } catch (error) {
    console.error('❌ 測試過程中發生錯誤:', error);
  }
}

async function main() {
  console.log('🚀 Telegram /list 指令測試工具');
  console.log('================================\n');

  // 檢查開發伺服器狀態
  try {
    const healthResponse = await fetch(`${BASE_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error('健康檢查失敗');
    }
    console.log('✅ 開發伺服器正常運行\n');
  } catch (error) {
    console.error('❌ 無法連接到開發伺服器');
    console.error('請確保運行: npm run dev');
    return;
  }

  await testListCommand();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { main };
} else {
  main();
}
