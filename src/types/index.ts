/**
 * Telegram 新聞推播系統 - 環境與型別定義
 * 繁體中文說明：定義 Cloudflare Workers 環境變數和系統使用的資料型別
 */

// Cloudflare Workers 環境綁定介面
export interface Env {
	// D1 資料庫綁定
	DB: D1Database;

	// Telegram Bot API Token
	TELEGRAM_BOT_TOKEN: string;

	// API 金鑰，用於保護 API 端點
	API_KEY: string;

	// Telegram Webhook 驗證密鑰
	TELEGRAM_WEBHOOK_SECRET: string;
}

// 新聞貼文資料結構
export interface Post {
	id?: number;
	source_username: string;
	start_date?: string; // YYYY-MM-DD（Asia/Taipei）
	end_date?: string; // YYYY-MM-DD（Asia/Taipei）
	post_date: string; // YYYY-MM-DD（Asia/Taipei）
	post_date_ts?: number; // UTC Unix 秒
	summary: string;
	url: string;
	get_date: string; // YYYY-MM-DD（Asia/Taipei）
	get_date_ts?: number; // UTC Unix 秒
	published?: number; // 0=未推播, 1=已推播
	published_at_ts?: number; // UTC Unix 秒
	attempt_count?: number; // 推播嘗試次數
	last_error?: string; // 最後錯誤訊息
	created_at_ts?: number; // UTC Unix 秒
	updated_at_ts?: number; // UTC Unix 秒
}

// 訂閱者資料結構
export interface Subscription {
	id?: number;
	chat_id: string; // Telegram 聊天 ID
	enabled?: number; // 0=停用, 1=啟用
	confirmed?: number; // 0=未確認, 1=已確認
	confirm_token?: string; // 訂閱確認 token
	confirm_token_expire_ts?: number; // Token 到期時間（UTC 秒）
	confirmed_at_ts?: number; // 確認時間（UTC 秒）
	filters_json?: string; // 過濾條件 JSON
	created_at_ts?: number; // UTC Unix 秒
	updated_at_ts?: number; // UTC Unix 秒
}

// 推播記錄資料結構
export interface Delivery {
	id?: number;
	post_id: number;
	subscription_id: number;
	chat_id: string;
	status?: string; // pending/sent/failed
	sent_at_ts?: number; // 成功送達時間（UTC 秒）
	error?: string; // 錯誤訊息
	retry_count?: number; // 重試次數
	created_at_ts?: number; // UTC Unix 秒
	updated_at_ts?: number; // UTC Unix 秒
}

// API 請求/回應介面
export interface IngestRequest {
	source_username: string;
	start_date?: string;
	end_date?: string;
	post_date: string;
	summary: string;
	url: string;
	get_date: string;
}

export interface IngestResponse {
	ok: boolean;
	inserted?: number;
	updated?: number;
	skipped?: number;
	error?: string;
}

export interface HealthResponse {
	ok: boolean;
	timestamp: string;
	database: boolean;
}

// Telegram API 相關型別
export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
	message_id: number;
	from?: TelegramUser;
	chat: TelegramChat;
	date: number;
	text?: string;
}

export interface TelegramUser {
	id: number;
	is_bot: boolean;
	first_name: string;
	last_name?: string;
	username?: string;
}

export interface TelegramChat {
	id: number;
	type: string; // 'private', 'group', 'supergroup', 'channel'
	title?: string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

export interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

// 結構化日誌介面
export interface LogEntry {
	timestamp: string; // ISO 時間戳
	level: 'debug' | 'info' | 'warn' | 'error';
	component: string; // 元件名稱（如：api, scheduler, telegram）
	operation: string; // 操作名稱
	data?: Record<string, any>; // 相關資料
	duration?: number; // 執行時間（毫秒）
	http_status?: number; // HTTP 狀態碼
	error?: string; // 錯誤訊息
}
