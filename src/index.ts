/**
 * Telegram 新聞推播系統 - 主應用程式
 * 繁體中文說明：基於 Cloudflare Workers + Hono + D1 的新聞廣播系統
 */

import { Hono } from 'hono';
import type { Env, HealthResponse } from './types';
import { handleIngest } from './handlers/ingest';
import { CronHandler } from './handlers/cronHandler';

// 建立 Hono 應用實例，並設定環境型別
const app = new Hono<{ Bindings: Env }>();

// 基本 CORS 處理
app.use('*', async (c, next) => {
	c.header('Access-Control-Allow-Origin', '*');
	c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	c.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

	if (c.req.method === 'OPTIONS') {
		return c.text('', 200);
	}

	await next();
});

// 統一錯誤處理中間件
app.onError((err, c) => {
	console.error('應用程式錯誤:', err);
	return c.json(
		{
			ok: false,
			error: '伺服器內部錯誤',
			message: err.message,
		},
		500
	);
});

// 404 處理
app.notFound((c) => {
	return c.json(
		{
			ok: false,
			error: '找不到請求的端點',
			path: c.req.path,
		},
		404
	);
});

// 健康檢查端點 - 無需認證
app.get('/health', async (c) => {
	console.log('健康檢查請求:', new Date().toISOString());

	try {
		// 測試資料庫連線
		const result = await c.env.DB.prepare('SELECT 1').first();

		const response: HealthResponse = {
			ok: true,
			timestamp: new Date().toISOString(),
			database: !!result,
		};

		return c.json(response);
	} catch (error) {
		console.error('健康檢查失敗:', error);
		return c.json(
			{
				ok: false,
				timestamp: new Date().toISOString(),
				database: false,
				error: error instanceof Error ? error.message : '未知錯誤',
			} as HealthResponse,
			500
		);
	}
});

// API 路由群組 - 需要身份驗證的公開 API
const apiRoutes = new Hono<{ Bindings: Env }>();

// API 身份驗證中間件
apiRoutes.use('*', async (c, next) => {
	const apiKey = c.req.header('X-API-Key');
	const expectedKey = c.env.API_KEY;

	console.log('API認證檢查:', {
		receivedKey: apiKey ? `${apiKey.substring(0, 8)}...` : 'undefined',
		expectedKeyLength: expectedKey ? expectedKey.length : 0,
		match: apiKey === expectedKey,
	});

	if (!apiKey || apiKey !== expectedKey) {
		return c.json(
			{
				ok: false,
				error: '未授權的請求',
				message: '缺少或無效的 API 金鑰',
			},
			401
		);
	}

	await next();
});

// 新聞資料接收端點
apiRoutes.post('/ingest', handleIngest);

// 訂閱管理路由群組
const subscriptionRoutes = new Hono<{ Bindings: Env }>();

subscriptionRoutes.get('/:chat_id/status', async (c) => {
	return c.json({
		ok: true,
		message: '訂閱狀態查詢 - 開發中',
	});
});

subscriptionRoutes.post('/', async (c) => {
	return c.json({
		ok: true,
		message: '建立訂閱 - 開發中',
	});
});

subscriptionRoutes.delete('/:chat_id', async (c) => {
	return c.json({
		ok: true,
		message: '取消訂閱 - 開發中',
	});
});

// Telegram Webhook 路由群組
const telegramRoutes = new Hono<{ Bindings: Env }>();

telegramRoutes.post('/webhook', async (c) => {
	return c.json({
		ok: true,
		message: 'Telegram Webhook - 開發中',
	});
});

// 管理員路由群組
const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.post('/push', async (c) => {
	return c.json({
		ok: true,
		message: '手動推播 - 開發中',
	});
});

// 註冊路由群組
app.route('/api', apiRoutes);
app.route('/subscriptions', subscriptionRoutes);
app.route('/tg', telegramRoutes);
app.route('/admin', adminRoutes);

// 主要應用程式匯出
export default {
	// HTTP 請求處理
	fetch: app.fetch,

	// Cron 排程處理（每小時執行推播任務）
	scheduled: async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
		const startTime = Date.now();
		console.log('=== Cron 定時任務觸發 ===', new Date().toISOString());
		console.log('Cron 規則:', event.cron);

		try {
			// 建立 Cron 處理器
			const cronHandler = new CronHandler(env);

			// 先驗證系統狀態
			const systemValid = await cronHandler.validateBroadcastSystem();
			if (!systemValid) {
				console.error('❌ 推播系統狀態檢查失敗，取消執行');
				return;
			}

			// 執行推播任務
			const stats = await cronHandler.executeBroadcast();

			// 輸出執行結果
			const executionTime = Date.now() - startTime;
			console.log('=== Cron 任務執行結果 ===');
			console.log(`總執行時間: ${executionTime}ms`);
			console.log(`處理貼文數: ${stats.processedPosts}`);
			console.log(`發送訊息數: ${stats.totalMessages}`);
			console.log(`成功發送: ${stats.successfulSends}`);
			console.log(`發送失敗: ${stats.failedSends}`);
			console.log(`跳過貼文: ${stats.skippedPosts}`);
			console.log('======================');
		} catch (error) {
			console.error('❌ Cron 定時任務執行失敗:', error);
			throw error; // 重新拋出錯誤，讓 Cloudflare 記錄失敗
		}
	},
};
