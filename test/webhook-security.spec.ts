import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.1 Webhook 安全性測試
 * 測試 Telegram Webhook 端點的安全性驗證機制
 */
describe('Webhook 安全性測試', () => {
	describe('POST /tg/webhook 安全驗證', () => {
		it('無效 Secret 應回傳 401 Unauthorized', async () => {
			// 準備測試資料：模擬 Telegram webhook 請求但使用錯誤的 secret
			const testPayload = {
				update_id: 123456,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: '/start',
					from: {
						id: 123456789,
						is_bot: false,
						first_name: '測試用戶',
						username: 'testuser',
					},
					chat: {
						id: 123456789,
						type: 'private',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// 使用錯誤的 X-Telegram-Bot-Api-Secret-Token
					'X-Telegram-Bot-Api-Secret-Token': 'invalid-secret-token',
				},
				body: JSON.stringify(testPayload),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應：應該是 401 Unauthorized
			expect(response.status).toBe(401);

			const responseText = await response.text();
			expect(responseText).toContain('Unauthorized');
		});

		it('缺少 Secret Header 應回傳 401 Unauthorized', async () => {
			const testPayload = {
				update_id: 123456,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: '/start',
					from: {
						id: 123456789,
						is_bot: false,
						first_name: '測試用戶',
						username: 'testuser',
					},
					chat: {
						id: 123456789,
						type: 'private',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// 故意省略 X-Telegram-Bot-Api-Secret-Token header
				},
				body: JSON.stringify(testPayload),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應：應該是 401 Unauthorized
			expect(response.status).toBe(401);
		});

		it('空的 Secret Token 應回傳 401 Unauthorized', async () => {
			const testPayload = {
				update_id: 123456,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: '/start',
					from: {
						id: 123456789,
						is_bot: false,
						first_name: '測試用戶',
						username: 'testuser',
					},
					chat: {
						id: 123456789,
						type: 'private',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': '', // 空的 secret token
				},
				body: JSON.stringify(testPayload),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應：應該是 401 Unauthorized
			expect(response.status).toBe(401);
		});

		it('非 POST 方法應回傳 405 Method Not Allowed', async () => {
			const request = new Request('http://example.com/tg/webhook', {
				method: 'GET',
				headers: {
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應：應該是 405 Method Not Allowed 或重導向到其他路由
			expect([405, 404]).toContain(response.status);
		});

		it('正確 Secret 但無效 JSON payload 應回傳 400 Bad Request', async () => {
			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: 'invalid-json-payload',
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應：應該是 400 Bad Request
			expect(response.status).toBe(400);
		});
	});

	describe('端點不存在測試', () => {
		it('不存在的路由應回傳 404', async () => {
			const request = new Request('http://example.com/nonexistent-route');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(404);
		});
	});
});
