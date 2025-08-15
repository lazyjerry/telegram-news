/**
 * Telegram 新聞推播系統 - Telegram API 服務
 * 繁體中文說明：封裝 Telegram Bot API 呼叫，包含訊息發送與 HTML 格式化
 */

import type { Env, Post, Delivery } from '../types';

/**
 * Telegram 內建鍵盤按鈕介面
 */
export interface InlineKeyboardButton {
	text: string;
	callback_data?: string;
	url?: string;
}

export interface InlineKeyboardMarkup {
	inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Telegram API 錯誤類型
 */
export interface TelegramError {
	error_code: number;
	description: string;
	parameters?: {
		retry_after?: number;
	};
}

/**
 * Telegram API 回應類型
 */
export interface TelegramResponse {
	ok: boolean;
	result?: any;
	error_code?: number;
	description?: string;
	parameters?: {
		retry_after?: number;
	};
}

/**
 * Telegram API 服務類別
 */
export class TelegramApiService {
	private env: Env;
	private baseUrl: string;

	constructor(env: Env) {
		this.env = env;
		this.baseUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
	}

	/**
	 * 發送新聞訊息到指定聊天
	 * @param chatId Telegram 聊天 ID
	 * @param post 新聞貼文資料
	 * @returns Promise<boolean> 發送是否成功
	 */
	async sendNewsMessage(chatId: string, post: Post): Promise<{ success: boolean; error?: string }> {
		try {
			console.log(`開始發送新聞訊息到聊天 ${chatId}，貼文 ID: ${post.id}`);

			// 格式化訊息內容
			const message = this.formatNewsMessage(post);

			// 發送 API 請求
			const response = await this.sendMessage(chatId, message);

			if (response.ok) {
				console.log(`新聞訊息成功發送到聊天 ${chatId}`);
				return { success: true };
			} else {
				const errorMsg = `發送失敗: ${response.description} (錯誤代碼: ${response.error_code})`;
				console.error(errorMsg);
				return { success: false, error: errorMsg };
			}
		} catch (error) {
			const errorMsg = `發送新聞訊息時發生異常: ${error instanceof Error ? error.message : '未知錯誤'}`;
			console.error(errorMsg);
			return { success: false, error: errorMsg };
		}
	}

	/**
	 * 發送互動訊息（支援內建鍵盤）
	 * @param chatId 聊天 ID
	 * @param text 訊息文本
	 * @param keyboard 可選的內建鍵盤
	 * @returns Promise<TelegramResponse> API 回應
	 */
	async sendInteractiveMessage(chatId: string | number, text: string, keyboard?: InlineKeyboardMarkup): Promise<TelegramResponse> {
		try {
			const url = `${this.baseUrl}/sendMessage`;
			const payload: any = {
				chat_id: chatId,
				text: text,
				parse_mode: 'HTML',
				disable_web_page_preview: false,
				disable_notification: false,
			};

			// 如果有提供鍵盤，添加到 payload
			if (keyboard) {
				payload.reply_markup = keyboard;
			}

			console.log(`發送互動訊息到聊天 ${chatId}，鍵盤: ${keyboard ? '有' : '無'}`);

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});

			const result = (await response.json()) as TelegramResponse;

			// 記錄 API 回應狀態
			if (!result.ok) {
				console.warn(`Telegram API 回應錯誤:`, result);

				// 處理速率限制
				if (result.error_code === 429) {
					await this.handleRateLimit(result);
				}
			} else {
				console.log(`互動訊息成功發送到聊天 ${chatId}`);
			}

			return result;
		} catch (error) {
			console.error('發送互動訊息時發生網路錯誤:', error);
			throw error;
		}
	}

	/**
	 * 呼叫 Telegram sendMessage API
	 * @param chatId 聊天 ID
	 * @param text 訊息文本
	 * @returns Promise<TelegramResponse> API 回應
	 */
	async sendMessage(chatId: string, text: string): Promise<TelegramResponse> {
		try {
			const url = `${this.baseUrl}/sendMessage`;
			const payload = {
				chat_id: chatId,
				text: text,
				parse_mode: 'HTML',
				disable_web_page_preview: false,
				disable_notification: false,
			};

			console.log(`呼叫 Telegram API: ${url}，聊天 ID: ${chatId}`);

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});

			const result = (await response.json()) as TelegramResponse;

			// 記錄 API 回應狀態
			if (!result.ok) {
				console.warn(`Telegram API 回應錯誤:`, result);
			}

			return result;
		} catch (error) {
			console.error('呼叫 Telegram API 時發生網路錯誤:', error);
			throw error;
		}
	}

	/**
	 * 格式化新聞訊息為整合的 HTML 格式
	 * 根據任務 19.1 需求：整合推播訊息內容，提升用戶閱讀體驗
	 * @param post 新聞貼文資料
	 * @returns 格式化後的整合 HTML 訊息
	 */
	private formatNewsMessage(post: Post): string {
		// HTML 特殊字符轉義
		const escapeHtml = (text: string): string => {
			return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		};

		// 格式化時間戳記為可讀格式
		const formatTimestamp = (timestamp?: number): string => {
			if (!timestamp) return '';
			const date = new Date(timestamp * 1000);
			return date.toLocaleString('zh-TW', {
				timeZone: 'Asia/Taipei',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit',
			});
		};

		// 建立整合的訊息內容
		let message = '';

		// 📰 新聞標題 (粗體，突出顯示)
		if (post.summary) {
			const escapedSummary = escapeHtml(post.summary);
			message += `📰 <b>${escapedSummary}</b>\n`;
			message += `${'─'.repeat(30)}\n\n`; // 分隔線提升視覺效果
		}

		// 📄 內容摘要 (如果標題和摘要不同，顯示詳細內容)
		if (post.summary && post.summary.length < 200) {
			// 如果標題較短，可能需要更多內容說明
			message += `📄 <i>詳細內容請點選下方連結查看</i>\n\n`;
		}

		// 📅 發布資訊
		message += `📅 <b>發布時間</b>\n`;
		if (post.post_date) {
			message += `   • 發布日期：${post.post_date}\n`;
		}
		if (post.post_date_ts) {
			message += `   • 發布時間：${formatTimestamp(post.post_date_ts)}\n`;
		}
		message += '\n';

		// 📰 來源資訊
		if (post.source_username) {
			message += `� <b>新聞來源</b>\n`;
			message += `   • ${escapeHtml(post.source_username)}\n\n`;
		}

		// 🔗 閱讀連結 (突出顯示)
		if (post.url) {
			message += `🔗 <b><a href="${post.url}">▶ 點此閱讀完整新聞內容</a></b>\n\n`;
		}

		// 📊 系統資訊 (較小字體)
		message += `<i>📊 系統資訊</i>\n`;
		if (post.get_date) {
			message += `<i>   • 資料擷取：${post.get_date}</i>\n`;
		}
		if (post.get_date_ts) {
			message += `<i>   • 處理時間：${formatTimestamp(post.get_date_ts)}</i>\n`;
		}

		// 💡 服務標識
		message += `\n<i>💡 由 Telegram 新聞推播系統提供</i>`;

		// 檢查訊息長度，Telegram 限制為 4096 字元
		if (message.length > 4090) {
			// 如果超出長度限制，優雅地截斷
			const truncatePoint = message.lastIndexOf('\n', 4000); // 在換行處截斷
			if (truncatePoint > 0) {
				message = message.substring(0, truncatePoint);
				message += '\n\n<i>📝 內容已截斷，請點選連結查看完整內容</i>';
			} else {
				// 強制截斷
				message = message.substring(0, 4087) + '...';
			}
		}

		return message;
	}

	/**
	 * 驗證 Bot Token 有效性
	 * @returns Promise<boolean> Token 是否有效
	 */
	async validateBotToken(): Promise<boolean> {
		try {
			const url = `${this.baseUrl}/getMe`;
			const response = await fetch(url);
			const result = (await response.json()) as TelegramResponse;

			if (result.ok) {
				console.log('Bot Token 驗證成功:', result.result);
				return true;
			} else {
				console.error('Bot Token 驗證失敗:', result.description);
				return false;
			}
		} catch (error) {
			console.error('驗證 Bot Token 時發生錯誤:', error);
			return false;
		}
	}

	/**
	 * 記錄推播結果到資料庫
	 * @param postId 貼文 ID
	 * @param subscriptionId 訂閱 ID
	 * @param chatId 聊天 ID
	 * @param success 發送是否成功
	 * @param error 錯誤訊息（如果失敗）
	 */
	async recordDelivery(postId: number, subscriptionId: number, chatId: string, success: boolean, error?: string): Promise<void> {
		try {
			const currentTimestamp = Math.floor(Date.now() / 1000);
			const status = success ? 'sent' : 'failed';

			await this.env.DB.prepare(
				`
        INSERT INTO deliveries (
          post_id, subscription_id, chat_id, status, sent_at_ts, error, 
          retry_count, created_at_ts, updated_at_ts
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
      `
			)
				.bind(postId, subscriptionId, chatId, status, success ? currentTimestamp : null, error || null, currentTimestamp, currentTimestamp)
				.run();

			console.log(`推播記錄已保存: 貼文 ${postId} -> 聊天 ${chatId}, 狀態: ${status}`);
		} catch (error) {
			console.error('保存推播記錄時發生錯誤:', error);
			// 不拋出異常，避免影響推播流程
		}
	}

	/**
	 * 處理 Telegram API 速率限制（429 錯誤）
	 * @param error Telegram API 錯誤回應
	 * @returns Promise<void> 等待指定時間
	 */
	async handleRateLimit(error: TelegramResponse): Promise<void> {
		if (error.error_code === 429 && error.parameters?.retry_after) {
			const retryAfter = error.parameters.retry_after;
			console.warn(`遇到速率限制，等待 ${retryAfter} 秒後重試`);

			// 等待指定的秒數
			await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
		}
	}
}
