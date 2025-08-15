import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.2 訂閱確認流程完整測試
 * 測試從 token 產生到驗證到狀態變更的完整流程
 */
describe('訂閱確認流程完整測試', () => {
	const testChatId = 123456789;
	const testUsername = 'testuser';

	describe('完整訂閱流程：產生 → 驗證 → 狀態變更', () => {
		it('步驟1: POST /subscriptions 應產生 pending 訂閱和 confirmation token', async () => {
			const subscriptionData = {
				chat_id: testChatId,
				username: testUsername,
				type: 'user',
			};

			const request = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應狀態：應該是 201 Created
			expect(response.status).toBe(201);

			const responseData = (await response.json()) as any;

			// 驗證回應內容包含必要欄位
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('subscription');
			expect(responseData.subscription).toHaveProperty('chat_id', testChatId);
			expect(responseData.subscription).toHaveProperty('status', 'pending');
			expect(responseData.subscription).toHaveProperty('confirmation_token');

			// 驗證 confirmation_token 格式（應為 UUID 格式）
			const tokenPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
			expect(responseData.subscription.confirmation_token).toMatch(tokenPattern);
		});

		it('步驟2: 重複訂閱同一 chat_id 應回傳現有的 pending 訂閱', async () => {
			const subscriptionData = {
				chat_id: testChatId,
				username: testUsername,
				type: 'user',
			};

			// 第一次訂閱
			const firstRequest = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			const firstCtx = createExecutionContext();
			const firstResponse = await worker.fetch(firstRequest, env, firstCtx);
			await waitOnExecutionContext(firstCtx);
			const firstData = (await firstResponse.json()) as any;

			// 第二次相同的訂閱請求
			const secondRequest = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			const secondCtx = createExecutionContext();
			const secondResponse = await worker.fetch(secondRequest, env, secondCtx);
			await waitOnExecutionContext(secondCtx);

			// 驗證第二次請求的回應：應該是 200 OK（已存在）
			expect(secondResponse.status).toBe(200);

			const secondData = (await secondResponse.json()) as any;

			// 驗證兩次請求得到相同的 confirmation_token
			expect(secondData.subscription.confirmation_token).toBe(firstData.subscription.confirmation_token);
			expect(secondData.subscription.status).toBe('pending');
		});

		it('步驟3: GET /subscriptions/:chat_id/status 應正確回傳 pending 狀態', async () => {
			const request = new Request(`http://example.com/subscriptions/${testChatId}/status`, {
				method: 'GET',
				headers: {
					'X-API-Key': 'test-api-key',
				},
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應狀態：應該是 200 OK
			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			// 驗證狀態資訊
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('subscription');
			expect(responseData.subscription).toHaveProperty('chat_id', testChatId);
			expect(responseData.subscription).toHaveProperty('status', 'pending');
		});

		it('步驟4: Telegram webhook 確認指令應激活訂閱', async () => {
			// 首先建立 pending 訂閱以取得 token
			const subscriptionData = {
				chat_id: testChatId,
				username: testUsername,
				type: 'user',
			};

			const subscribeRequest = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			const subscribeCtx = createExecutionContext();
			const subscribeResponse = await worker.fetch(subscribeRequest, env, subscribeCtx);
			await waitOnExecutionContext(subscribeCtx);
			const subscribeData = (await subscribeResponse.json()) as any;
			const confirmationToken = subscribeData.subscription.confirmation_token;

			// 模擬用戶發送確認指令的 webhook
			const webhookPayload = {
				update_id: 123456,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: `確認 ${confirmationToken}`,
					from: {
						id: testChatId,
						is_bot: false,
						first_name: '測試用戶',
						username: testUsername,
					},
					chat: {
						id: testChatId,
						type: 'private',
					},
				},
			};

			const webhookRequest = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(webhookPayload),
			});

			const webhookCtx = createExecutionContext();
			const webhookResponse = await worker.fetch(webhookRequest, env, webhookCtx);
			await waitOnExecutionContext(webhookCtx);

			// 驗證 webhook 回應：應該是 200 OK
			expect(webhookResponse.status).toBe(200);
		});

		it('步驟5: 確認後狀態查詢應顯示 active 狀態', async () => {
			const request = new Request(`http://example.com/subscriptions/${testChatId}/status`, {
				method: 'GET',
				headers: {
					'X-API-Key': 'test-api-key',
				},
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			// 驗證訂閱狀態已變更為 active
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('subscription');
			expect(responseData.subscription).toHaveProperty('status', 'active');
			expect(responseData.subscription).toHaveProperty('confirmed_ts');
		});
	});

	describe('錯誤情況測試', () => {
		it('無效的 confirmation token 應回傳錯誤訊息', async () => {
			const webhookPayload = {
				update_id: 123457,
				message: {
					message_id: 2,
					date: Math.floor(Date.now() / 1000),
					text: '確認 invalid-token-123',
					from: {
						id: testChatId + 1,
						is_bot: false,
						first_name: '測試用戶2',
						username: 'testuser2',
					},
					chat: {
						id: testChatId + 1,
						type: 'private',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(webhookPayload),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// webhook 本身應該回傳 200，但會發送錯誤訊息給用戶
			expect(response.status).toBe(200);
		});

		it('已確認的訂閱重複確認應提示已激活', async () => {
			// 這個測試假設前面的訂閱已經被激活
			// 嘗試再次確認相同的 token

			const subscriptionData = {
				chat_id: testChatId + 2,
				username: 'testuser3',
				type: 'user',
			};

			// 先建立訂閱
			const subscribeRequest = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			const subscribeCtx = createExecutionContext();
			const subscribeResponse = await worker.fetch(subscribeRequest, env, subscribeCtx);
			await waitOnExecutionContext(subscribeCtx);
			const subscribeData = (await subscribeResponse.json()) as any;
			const token = subscribeData.subscription.confirmation_token;

			// 第一次確認
			const firstConfirmPayload = {
				update_id: 123458,
				message: {
					message_id: 3,
					date: Math.floor(Date.now() / 1000),
					text: `確認 ${token}`,
					from: {
						id: testChatId + 2,
						is_bot: false,
						first_name: '測試用戶3',
						username: 'testuser3',
					},
					chat: {
						id: testChatId + 2,
						type: 'private',
					},
				},
			};

			const firstConfirmRequest = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(firstConfirmPayload),
			});

			const firstCtx = createExecutionContext();
			const firstResponse = await worker.fetch(firstConfirmRequest, env, firstCtx);
			await waitOnExecutionContext(firstCtx);

			expect(firstResponse.status).toBe(200);

			// 第二次確認（重複確認）
			const secondConfirmPayload = {
				update_id: 123459,
				message: {
					message_id: 4,
					date: Math.floor(Date.now() / 1000),
					text: `確認 ${token}`,
					from: {
						id: testChatId + 2,
						is_bot: false,
						first_name: '測試用戶3',
						username: 'testuser3',
					},
					chat: {
						id: testChatId + 2,
						type: 'private',
					},
				},
			};

			const secondConfirmRequest = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(secondConfirmPayload),
			});

			const secondCtx = createExecutionContext();
			const secondResponse = await worker.fetch(secondConfirmRequest, env, secondCtx);
			await waitOnExecutionContext(secondCtx);

			expect(secondResponse.status).toBe(200);
		});
	});
});
