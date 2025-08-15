/**
 * Telegram 新聞推播系統 - Telegram Webhook 處理程式
 * 繁體中文說明：處理 POST /tg/webhook 端點，驗證與處理 Telegram Bot Updates
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { TelegramService } from '../services/telegramService';

/**
 * Telegram Update 物件基本結構定義
 */
export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
	edited_message?: TelegramMessage;
	channel_post?: TelegramMessage;
	edited_channel_post?: TelegramMessage;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
	reply_to_message?: TelegramMessage;
}

export interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
	language_code?: string;
}

export interface TelegramChat {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	inline_message_id?: string;
	chat_instance: string;
	data?: string;
}

/**
 * Webhook 回應格式
 */
export interface WebhookResponse {
	ok: boolean;
	message?: string;
	error?: string;
}

/**
 * 驗證 Telegram Webhook 安全性
 * 檢查 X-Telegram-Bot-Api-Secret-Token header 是否與環境變數相符
 * @param c Hono Context 物件
 * @param env 環境變數
 * @returns 是否通過驗證
 */
function validateWebhookSecurity(c: Context, env: Env): boolean {
	console.log('開始驗證 Telegram Webhook 安全性');

	// 取得請求 header 中的 Secret Token
	const receivedSecret = c.req.header('X-Telegram-Bot-Api-Secret-Token');
	const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;

	console.log('Webhook 安全驗證:', {
		hasReceivedSecret: !!receivedSecret,
		hasExpectedSecret: !!expectedSecret,
		secretsMatch: receivedSecret === expectedSecret,
	});

	// 檢查是否有提供 Secret Token
	if (!receivedSecret) {
		console.warn('❌ 缺少 X-Telegram-Bot-Api-Secret-Token header');
		return false;
	}

	// 檢查環境變數是否設定
	if (!expectedSecret) {
		console.error('❌ 環境變數 TELEGRAM_WEBHOOK_SECRET 未設定');
		return false;
	}

	// 比對 Secret Token
	if (receivedSecret !== expectedSecret) {
		console.warn('❌ Secret Token 不匹配');
		return false;
	}

	console.log('✅ Webhook 安全驗證通過');
	return true;
}

/**
 * 驗證 Telegram Update 物件結構
 * @param updateData 解析後的 Update 資料
 * @returns 是否為有效的 Update 物件
 */
function validateTelegramUpdate(updateData: any): updateData is TelegramUpdate {
	// 檢查基本結構
	if (!updateData || typeof updateData !== 'object') {
		console.warn('❌ Update 物件格式無效');
		return false;
	}

	// 檢查 update_id 是否存在且為數字
	if (typeof updateData.update_id !== 'number') {
		console.warn('❌ 缺少有效的 update_id');
		return false;
	}

	// 檢查是否有任何支援的更新類型
	const supportedTypes = ['message', 'callback_query', 'edited_message'];
	const hasValidType = supportedTypes.some((type) => updateData[type]);

	if (!hasValidType) {
		console.warn('❌ 不支援的 Update 類型');
		return false;
	}

	console.log('✅ Telegram Update 物件驗證通過');
	return true;
}

/**
 * 處理 Telegram Webhook 請求
 * POST /tg/webhook 端點的主要處理函數
 * @param c Hono Context 物件
 * @returns Promise<Response> HTTP 回應
 */
export async function handleTelegramWebhook(c: Context<{ Bindings: Env }>): Promise<Response> {
	const startTime = Date.now();
	console.log('=== 收到 Telegram Webhook 請求 ===', new Date().toISOString());

	try {
		const env = c.env;

		// 步驟 1：安全性驗證
		if (!validateWebhookSecurity(c, env)) {
			console.error('❌ Webhook 安全驗證失敗');
			return c.json<WebhookResponse>(
				{
					ok: false,
					error: '未授權的請求',
				},
				401
			);
		}

		// 步驟 2：解析請求體
		let updateData: any;
		try {
			updateData = await c.req.json();
			console.log('收到 Update 資料:', {
				update_id: updateData?.update_id,
				hasMessage: !!updateData?.message,
				hasCallbackQuery: !!updateData?.callback_query,
				chatType: updateData?.message?.chat?.type || updateData?.callback_query?.message?.chat?.type,
			});
		} catch (parseError) {
			console.error('❌ JSON 解析失敗:', parseError);
			return c.json<WebhookResponse>(
				{
					ok: false,
					error: '無效的 JSON 格式',
				},
				400
			);
		}

		// 步驟 3：驗證 Update 物件結構
		if (!validateTelegramUpdate(updateData)) {
			console.error('❌ Update 物件驗證失敗');
			return c.json<WebhookResponse>(
				{
					ok: false,
					error: '無效的 Update 格式',
				},
				400
			);
		}

		// 步驟 4：建立 TelegramService 並處理 Update
		const telegramService = new TelegramService(env);

		try {
			await telegramService.processUpdate(updateData);

			const processingTime = Date.now() - startTime;
			console.log(`✅ Webhook 處理完成，耗時: ${processingTime}ms`);

			// 回傳成功回應給 Telegram
			return c.json<WebhookResponse>({
				ok: true,
				message: 'Update 處理完成',
			});
		} catch (processingError) {
			console.error('❌ Update 處理失敗:', processingError);

			// 即使處理失敗，也要回傳 200 給 Telegram，避免重複發送
			return c.json<WebhookResponse>({
				ok: false,
				error: '處理過程中發生錯誤',
				message: '已記錄錯誤，將稍後重試',
			});
		}
	} catch (error) {
		const processingTime = Date.now() - startTime;
		console.error('❌ Webhook 處理發生嚴重錯誤:', error);
		console.error(`處理耗時: ${processingTime}ms`);

		// 對於嚴重錯誤，回傳 500 狀態碼
		return c.json<WebhookResponse>(
			{
				ok: false,
				error: '伺服器內部錯誤',
			},
			500
		);
	}
}

/**
 * 處理 Webhook 設定請求（輔助功能）
 * GET /tg/webhook 端點，用於檢查 webhook 設定狀態
 * @param c Hono Context 物件
 * @returns Promise<Response> webhook 狀態資訊
 */
export async function getWebhookStatus(c: Context<{ Bindings: Env }>): Promise<Response> {
	console.log('檢查 Webhook 狀態');

	try {
		const env = c.env;

		// 檢查必要的環境變數
		const hasSecret = !!env.TELEGRAM_WEBHOOK_SECRET;
		const hasBotToken = !!env.TELEGRAM_BOT_TOKEN;

		return c.json({
			ok: true,
			webhook_configured: hasSecret && hasBotToken,
			has_secret: hasSecret,
			has_bot_token: hasBotToken,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error('Webhook 狀態檢查失敗:', error);
		return c.json(
			{
				ok: false,
				error: '無法檢查 Webhook 狀態',
			},
			500
		);
	}
}
