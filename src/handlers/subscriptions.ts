/**
 * Telegram 新聞推播系統 - 訂閱管理處理程式
 * 繁體中文說明：處理訂閱相關的 API 端點，包含建立、查詢、停用訂閱功能
 */

import type { Context } from 'hono';
import type { Env, Subscription } from '../types';
import { getCurrentTimestamp } from '../utils/timeUtils';

/**
 * 訂閱建立請求格式
 */
export interface CreateSubscriptionRequest {
	chat_id: string; // Telegram 聊天 ID
	filters_json?: string; // 可選的篩選條件（JSON 格式）
}

/**
 * 訂閱建立回應格式
 */
export interface CreateSubscriptionResponse {
	ok: boolean;
	subscription_id?: number;
	chat_id?: string;
	status?: string;
	confirm_url?: string;
	confirm_token?: string;
	expires_at?: number;
	error?: string;
	message?: string;
}

/**
 * 訂閱狀態查詢回應格式
 */
export interface SubscriptionStatusResponse {
	ok: boolean;
	chat_id?: string;
	status?: string;
	enabled?: boolean;
	confirmed?: boolean;
	subscribe_ts?: number;
	confirm_ts?: number;
	token_expired?: boolean;
	error?: string;
	message?: string;
}

/**
 * 訂閱停用回應格式
 */
export interface DeleteSubscriptionResponse {
	ok: boolean;
	chat_id?: string;
	message?: string;
	cancelled_at?: number;
	error?: string;
}

/**
 * 訂閱確認回應格式
 */
export interface ConfirmSubscriptionResponse {
	ok: boolean;
	chat_id?: string;
	message?: string;
	confirmed_at?: number;
	token?: string;
	error?: string;
}

/**
 * 驗證 Telegram Chat ID 格式
 * @param chatId 聊天 ID 字串
 * @returns 是否為有效的 Telegram Chat ID
 */
function validateChatId(chatId: string): boolean {
	// Telegram Chat ID 格式：
	// - 個人用戶：正整數（1-9999999999）
	// - 群組/頻道：負整數（-1000000000000 到 -1）
	const chatIdPattern = /^-?\d+$/;
	if (!chatIdPattern.test(chatId)) {
		return false;
	}

	const numericId = parseInt(chatId, 10);

	// 檢查範圍（Telegram 官方限制）
	if (numericId > 0) {
		// 個人用戶 ID 範圍
		return numericId >= 1 && numericId <= 9999999999;
	} else {
		// 群組/頻道 ID 範圍
		return numericId >= -1000000000000 && numericId <= -1;
	}
}

/**
 * 產生安全的確認 token
 * @returns 隨機 UUID token
 */
function generateConfirmToken(): string {
	// 使用 crypto.randomUUID() 產生安全的隨機 token
	return crypto.randomUUID();
}

/**
 * 查詢現有訂閱記錄
 * @param env 環境變數
 * @param chatId 聊天 ID
 * @returns 訂閱記錄或 null
 */
async function findSubscriptionByChatId(env: Env, chatId: string): Promise<Subscription | null> {
	try {
		const result = await env.DB.prepare('SELECT * FROM subscriptions WHERE chat_id = ? LIMIT 1').bind(chatId).first();

		return result ? (result as unknown as Subscription) : null;
	} catch (error) {
		console.error('查詢訂閱記錄失敗:', error);
		return null;
	}
}

/**
 * 查詢指定 token 的訂閱記錄
 * @param env 環境變數
 * @param token 確認 token
 * @returns 訂閱記錄或 null
 */
async function findSubscriptionByToken(env: Env, token: string): Promise<Subscription | null> {
	try {
		const result = await env.DB.prepare('SELECT * FROM subscriptions WHERE confirm_token = ? LIMIT 1').bind(token).first();

		return result ? (result as unknown as Subscription) : null;
	} catch (error) {
		console.error('根據 token 查詢訂閱記錄失敗:', error);
		return null;
	}
}

/**
 * 處理 POST /subscriptions 訂閱建立請求
 * @param c Hono Context 物件
 * @returns Promise<Response> 處理結果回應
 */
export async function handleCreateSubscription(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		console.log('開始處理訂閱建立請求:', new Date().toISOString());

		// 1. 解析請求主體
		let body: CreateSubscriptionRequest;
		try {
			body = await c.req.json();
		} catch (error) {
			console.error('JSON 解析失敗:', error);
			return c.json(
				{
					ok: false,
					error: '無效的 JSON 格式',
					message: '請確認請求主體為有效的 JSON 格式',
				} as CreateSubscriptionResponse,
				400
			);
		}

		// 2. 驗證必要欄位
		if (!body.chat_id) {
			return c.json(
				{
					ok: false,
					error: '缺少必要欄位',
					message: '請提供 chat_id 欄位',
				} as CreateSubscriptionResponse,
				400
			);
		}

		// 3. 驗證 Chat ID 格式
		if (!validateChatId(body.chat_id)) {
			return c.json(
				{
					ok: false,
					error: '無效的 chat_id 格式',
					message: 'chat_id 必須為有效的 Telegram Chat ID（正整數或負整數）',
				} as CreateSubscriptionResponse,
				400
			);
		}

		// 4. 驗證 filters_json 格式（如果提供）
		if (body.filters_json) {
			try {
				JSON.parse(body.filters_json);
			} catch (error) {
				return c.json(
					{
						ok: false,
						error: '無效的 filters_json 格式',
						message: 'filters_json 必須為有效的 JSON 字串',
					} as CreateSubscriptionResponse,
					400
				);
			}
		}

		// 5. 檢查是否已存在訂閱
		const existingSubscription = await findSubscriptionByChatId(c.env, body.chat_id);
		const currentTimestamp = getCurrentTimestamp();

		if (existingSubscription) {
			// 6. 更新現有訂閱記錄 - 直接啟用確認狀態
			console.log(`更新現有訂閱記錄，Chat ID: ${body.chat_id}`);

			await c.env.DB.prepare(
				`
				UPDATE subscriptions SET
					enabled = 1,
					confirmed = 1,
					confirm_token = NULL,
					confirm_token_expire_ts = NULL,
					confirmed_at_ts = ?,
					filters_json = ?,
					updated_at_ts = ?
				WHERE chat_id = ?
				`
			)
				.bind(currentTimestamp, body.filters_json || null, currentTimestamp, body.chat_id)
				.run();

			console.log(`訂閱記錄更新成功，Chat ID: ${body.chat_id}，已直接啟用`);

			return c.json({
				ok: true,
				subscription_id: existingSubscription.id,
				chat_id: body.chat_id,
				status: 'confirmed',
				message: '訂閱已成功更新並啟用！您將開始收到新聞推播',
			} as CreateSubscriptionResponse);
		} else {
			// 7. 建立新訂閱記錄 - 直接啟用確認狀態
			console.log(`建立新訂閱記錄，Chat ID: ${body.chat_id}`);

			const result = await c.env.DB.prepare(
				`
				INSERT INTO subscriptions (
					chat_id, enabled, confirmed, confirm_token, confirm_token_expire_ts,
					confirmed_at_ts, filters_json, created_at_ts, updated_at_ts
				) VALUES (?, 1, 1, NULL, NULL, ?, ?, ?, ?)
				`
			)
				.bind(body.chat_id, currentTimestamp, body.filters_json || null, currentTimestamp, currentTimestamp)
				.run();

			const newSubscriptionId = result.meta.last_row_id as number;
			console.log(`新訂閱記錄建立成功，ID: ${newSubscriptionId}, Chat ID: ${body.chat_id}，已直接啟用`);

			return c.json({
				ok: true,
				subscription_id: newSubscriptionId,
				chat_id: body.chat_id,
				status: 'confirmed',
				message: '訂閱建立成功！您將開始收到新聞推播',
			} as CreateSubscriptionResponse);
		}
	} catch (error) {
		console.error('處理訂閱建立請求時發生錯誤:', error);
		return c.json(
			{
				ok: false,
				error: '伺服器內部錯誤',
				message: error instanceof Error ? error.message : '未知錯誤',
			} as CreateSubscriptionResponse,
			500
		);
	}
}

/**
 * 處理 GET /subscriptions/:chat_id/status 狀態查詢請求
 * @param c Hono Context 物件
 * @returns Promise<Response> 處理結果回應
 */
export async function handleGetSubscriptionStatus(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		// 1. 取得路由參數
		const chatId = c.req.param('chat_id');

		if (!chatId) {
			return c.json(
				{
					ok: false,
					error: '缺少路由參數',
					message: '請在 URL 中提供 chat_id 參數',
				} as SubscriptionStatusResponse,
				400
			);
		}

		// 2. 驗證 Chat ID 格式
		if (!validateChatId(chatId)) {
			return c.json(
				{
					ok: false,
					error: '無效的 chat_id 格式',
					message: 'chat_id 必須為有效的 Telegram Chat ID（正整數或負整數）',
				} as SubscriptionStatusResponse,
				400
			);
		}

		console.log(`查詢訂閱狀態，Chat ID: ${chatId}`);

		// 3. 查詢訂閱記錄
		const subscription = await findSubscriptionByChatId(c.env, chatId);

		if (!subscription) {
			return c.json(
				{
					ok: false,
					error: '訂閱不存在',
					message: `Chat ID ${chatId} 的訂閱記錄不存在`,
				} as SubscriptionStatusResponse,
				404
			);
		}

		// 4. 判斷訂閱狀態
		let status = 'unknown';
		let tokenExpired = false;
		const currentTimestamp = getCurrentTimestamp();

		if (!subscription.enabled) {
			status = 'cancelled';
		} else if (!subscription.confirmed) {
			status = 'pending';
			// 檢查 token 是否過期
			if (subscription.confirm_token_expire_ts && subscription.confirm_token_expire_ts < currentTimestamp) {
				tokenExpired = true;
			}
		} else {
			status = 'confirmed';
		}

		console.log(`訂閱狀態查詢成功，Chat ID: ${chatId}, 狀態: ${status}`);

		return c.json({
			ok: true,
			chat_id: chatId,
			status: status,
			enabled: Boolean(subscription.enabled),
			confirmed: Boolean(subscription.confirmed),
			subscribe_ts: subscription.created_at_ts,
			confirm_ts: subscription.confirmed_at_ts,
			token_expired: tokenExpired,
			message: `訂閱狀態: ${status}`,
		} as SubscriptionStatusResponse);
	} catch (error) {
		console.error('處理訂閱狀態查詢請求時發生錯誤:', error);
		return c.json(
			{
				ok: false,
				error: '伺服器內部錯誤',
				message: error instanceof Error ? error.message : '未知錯誤',
			} as SubscriptionStatusResponse,
			500
		);
	}
}

/**
 * 處理 DELETE /subscriptions/:chat_id 訂閱停用請求
 * @param c Hono Context 物件
 * @returns Promise<Response> 處理結果回應
 */
export async function handleDeleteSubscription(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		// 1. 取得路由參數
		const chatId = c.req.param('chat_id');

		if (!chatId) {
			return c.json(
				{
					ok: false,
					error: '缺少路由參數',
					message: '請在 URL 中提供 chat_id 參數',
				} as DeleteSubscriptionResponse,
				400
			);
		}

		// 2. 驗證 Chat ID 格式
		if (!validateChatId(chatId)) {
			return c.json(
				{
					ok: false,
					error: '無效的 chat_id 格式',
					message: 'chat_id 必須為有效的 Telegram Chat ID（正整數或負整數）',
				} as DeleteSubscriptionResponse,
				400
			);
		}

		console.log(`處理訂閱停用請求，Chat ID: ${chatId}`);

		// 3. 查詢現有訂閱記錄
		const existingSubscription = await findSubscriptionByChatId(c.env, chatId);

		if (!existingSubscription) {
			return c.json(
				{
					ok: false,
					error: '訂閱不存在',
					message: `Chat ID ${chatId} 的訂閱記錄不存在`,
				} as DeleteSubscriptionResponse,
				404
			);
		}

		// 4. 檢查是否已經停用（冪等性設計）
		if (!existingSubscription.enabled) {
			console.log(`訂閱已經停用，Chat ID: ${chatId}`);
			return c.json({
				ok: true,
				chat_id: chatId,
				message: '訂閱已經處於停用狀態',
				cancelled_at: existingSubscription.updated_at_ts,
			} as DeleteSubscriptionResponse);
		}

		// 5. 執行軟刪除（設定 enabled = 0，保留歷史記錄）
		const currentTimestamp = getCurrentTimestamp();

		await c.env.DB.prepare(
			`
			UPDATE subscriptions SET
				enabled = 0,
				confirmed = 0,
				confirm_token = NULL,
				confirm_token_expire_ts = NULL,
				updated_at_ts = ?
			WHERE chat_id = ?
			`
		)
			.bind(currentTimestamp, chatId)
			.run();

		console.log(`訂閱停用成功，Chat ID: ${chatId}`);

		return c.json({
			ok: true,
			chat_id: chatId,
			message: '訂閱已成功停用',
			cancelled_at: currentTimestamp,
		} as DeleteSubscriptionResponse);
	} catch (error) {
		console.error('處理訂閱停用請求時發生錯誤:', error);
		return c.json(
			{
				ok: false,
				error: '伺服器內部錯誤',
				message: error instanceof Error ? error.message : '未知錯誤',
			} as DeleteSubscriptionResponse,
			500
		);
	}
}

/**
 * 處理 GET /subscriptions/confirm 訂閱確認請求
 * @param c Hono Context 物件
 * @returns Promise<Response> 處理結果回應
 */
export async function handleConfirmSubscription(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		// 1. 取得查詢參數中的 token
		const token = c.req.query('token');

		if (!token) {
			return c.json(
				{
					ok: false,
					error: '缺少確認 token',
					message: '請在 URL 中提供 token 參數',
				} as ConfirmSubscriptionResponse,
				400
			);
		}

		console.log(`處理訂閱確認請求，Token: ${token.substring(0, 8)}...`);

		// 2. 根據 token 查詢訂閱記錄
		const subscription = await findSubscriptionByToken(c.env, token);

		if (!subscription) {
			return c.json(
				{
					ok: false,
					error: '無效的確認 token',
					message: '找不到對應的訂閱記錄，token 可能已過期或無效',
				} as ConfirmSubscriptionResponse,
				404
			);
		}

		// 3. 檢查訂閱是否已經確認
		if (subscription.confirmed) {
			console.log(`訂閱已經確認，Chat ID: ${subscription.chat_id}`);
			return c.json({
				ok: true,
				chat_id: subscription.chat_id,
				message: '訂閱已經處於確認狀態',
				confirmed_at: subscription.confirmed_at_ts,
			} as ConfirmSubscriptionResponse);
		}

		// 4. 檢查 token 是否過期
		const currentTimestamp = getCurrentTimestamp();
		if (subscription.confirm_token_expire_ts && subscription.confirm_token_expire_ts < currentTimestamp) {
			console.log(`確認 token 已過期，Chat ID: ${subscription.chat_id}`);
			return c.json(
				{
					ok: false,
					error: '確認 token 已過期',
					message: '請重新申請訂閱確認',
				} as ConfirmSubscriptionResponse,
				410
			);
		}

		// 5. 確認訂閱
		await c.env.DB.prepare(
			`
			UPDATE subscriptions SET
				confirmed = 1,
				confirmed_at_ts = ?,
				confirm_token = NULL,
				confirm_token_expire_ts = NULL,
				updated_at_ts = ?
			WHERE id = ?
			`
		)
			.bind(currentTimestamp, currentTimestamp, subscription.id)
			.run();

		console.log(`訂閱確認成功，Chat ID: ${subscription.chat_id}`);

		return c.json({
			ok: true,
			chat_id: subscription.chat_id,
			message: '訂閱確認成功！您現在將收到新聞推播',
			confirmed_at: currentTimestamp,
		} as ConfirmSubscriptionResponse);
	} catch (error) {
		console.error('處理訂閱確認請求時發生錯誤:', error);
		return c.json(
			{
				ok: false,
				error: '伺服器內部錯誤',
				message: error instanceof Error ? error.message : '未知錯誤',
			} as ConfirmSubscriptionResponse,
			500
		);
	}
}
