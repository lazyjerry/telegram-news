/**
 * 調試腳本：測試訂閱確認流程
 * 用於檢查和修復訂閱確認 token 的問題
 */

const API_KEY = 'f8e2b4a7d3c9e1f4b6a8c7e9d2f5b4a3c6e1f8d4b7a2c9e5f1b8d6a4c7e3f9b2';
const BASE_URL = 'http://localhost:8787';

async function testSubscriptionFlow() {
  console.log('🔍 開始測試訂閱確認流程...\n');

  try {
    // 1. 建立一個測試訂閱
    console.log('📝 步驟 1: 建立測試訂閱');
    const createResponse = await fetch(`${BASE_URL}/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        chat_id: '12345678',
        filters: {
          usernames: ['test_user']
        }
      })
    });

    const createResult = await createResponse.json();
    console.log('建立訂閱結果:', createResult);

    if (!createResult.ok) {
      console.error('❌ 建立訂閱失敗');
      return;
    }

    const confirmUrl = createResult.confirm_url;
    const token = createResult.confirm_token;
    
    console.log('✅ 訂閱建立成功');
    console.log('確認網址:', confirmUrl);
    console.log('Token:', token);

    // 等待一秒
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. 測試確認 token
    console.log('\n📝 步驟 2: 測試確認 token');
    const confirmResponse = await fetch(`${BASE_URL}/subscriptions/confirm?token=${token}`);
    const confirmResult = await confirmResponse.json();
    
    console.log('確認結果:', confirmResult);
    console.log('HTTP 狀態:', confirmResponse.status);

    if (confirmResult.ok) {
      console.log('✅ 訂閱確認成功！');
    } else {
      console.error('❌ 訂閱確認失敗:', confirmResult.error);
      console.error('錯誤訊息:', confirmResult.message);
    }

    // 3. 檢查訂閱狀態
    console.log('\n📝 步驟 3: 檢查訂閱狀態');
    const statusResponse = await fetch(`${BASE_URL}/subscriptions/12345678/status`, {
      headers: {
        'X-API-Key': API_KEY
      }
    });

    const statusResult = await statusResponse.json();
    console.log('訂閱狀態:', statusResult);

  } catch (error) {
    console.error('❌ 測試過程中發生錯誤:', error);
  }
}

async function main() {
  console.log('🚀 Telegram 新聞系統 - 訂閱確認流程調試工具');
  console.log('================================================\n');

  // 確保本地開發伺服器正在運行
  try {
    const healthResponse = await fetch(`${BASE_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error('健康檢查失敗');
    }
    console.log('✅ 本地開發伺服器正在運行\n');
  } catch (error) {
    console.error('❌ 無法連接到本地開發伺服器');
    console.error('請確保運行: npm run dev');
    return;
  }

  await testSubscriptionFlow();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { main };
} else {
  main();
}
