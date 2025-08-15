/**
 * 測試工具和 Mock 函數
 * 提供測試環境所需的模擬對象和輔助函數
 */
import { vi, expect } from 'vitest';

// Mock Cloudflare Workers 環境
export const mockEnv = {
	DB: {
		prepare: (sql: string) => ({
			bind: (...params: any[]) => ({
				all: async () => ({ results: [] }),
				first: async () => null,
				run: async () => ({ success: true, meta: { changes: 1 } }),
			}),
		}),
		exec: async (sql: string) => ({ count: 0, duration: 0 }),
	},
	TELEGRAM_BOT_TOKEN: 'test-bot-token',
	WEBHOOK_SECRET: 'test-webhook-secret',
};

// Mock Request
export class MockRequest {
	private _url: string;
	private _method: string;
	private _headers: Headers;
	private _body: any;

	constructor(url: string, options: RequestInit = {}) {
		this._url = url;
		this._method = options.method || 'GET';
		this._headers = new Headers(options.headers);
		this._body = options.body;
	}

	get url() {
		return this._url;
	}
	get method() {
		return this._method;
	}
	get headers() {
		return this._headers;
	}

	async json() {
		return this._body ? JSON.parse(this._body) : {};
	}

	async text() {
		return this._body || '';
	}
}

// Mock Response
export class MockResponse {
	private _status: number;
	private _body: any;
	private _headers: Headers;

	constructor(body: any, options: ResponseInit = {}) {
		this._status = options.status || 200;
		this._body = body;
		this._headers = new Headers(options.headers);
	}

	get status() {
		return this._status;
	}
	get headers() {
		return this._headers;
	}

	async json() {
		return typeof this._body === 'string' ? JSON.parse(this._body) : this._body;
	}

	async text() {
		return typeof this._body === 'string' ? this._body : JSON.stringify(this._body);
	}
}

// Mock fetch
export const mockFetch = (response: any = {}, status: number = 200) => {
	return vi.fn().mockResolvedValue(new MockResponse(response, { status }));
};

// 測試用的 Telegram 用戶
export const mockTelegramUser = {
	id: 12345678,
	first_name: '測試用戶',
	username: 'test_user',
	language_code: 'zh-tw',
};

// 測試用的 Telegram 群組
export const mockTelegramGroup = {
	id: -1001234567890,
	title: '測試群組',
	type: 'supergroup',
};

// 測試用的新聞文章
export const mockNewsArticle = {
	id: 1,
	url: 'https://example.com/news/1',
	title: '測試新聞標題',
	content: '這是一篇測試新聞的內容...',
	published_date: '2024-01-01T10:00:00Z',
	is_published: false,
};

// 工具函數：等待指定時間
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 工具函數：生成隨機字符串
export const generateRandomString = (length: number = 10) => {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
};

// 斷言輔助函數
export const assertValidResponse = (response: MockResponse) => {
	expect(response.status).toBeLessThan(500);
	expect([200, 201, 400, 401, 403, 404, 429].includes(response.status)).toBe(true);
};

// 時間測量輔助函數
export const measureTime = async (fn: () => Promise<any>) => {
	const start = Date.now();
	const result = await fn();
	const duration = Date.now() - start;
	return { result, duration };
};
