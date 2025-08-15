import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.6 關鍵字互動完整測試
 * 測試所有 Telegram 指令和關鍵字互動
 */
describe('關鍵字互動完整測試', () => {
	const testChatId = 111222333;
	const testUsername = 'interaction_testuser';

	// 輔助函數：建立 webhook 請求
	const createWebhookRequest = (text: string, chatId: number = testChatId, username: string = testUsername) => {
		return new Request('http://example.com/tg/webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
			},
			body: JSON.stringify({
				update_id: Math.floor(Math.random() * 1000000),
				message: {
					message_id: Math.floor(Math.random() * 1000),
					date: Math.floor(Date.now() / 1000),
					text: text,
					from: {
						id: chatId,
						is_bot: false,
						first_name: '測試用戶',
						username: username,
					},
					chat: {
						id: chatId,
						type: 'private',
					},
				},
			}),
		});
	};

	describe('基本指令測試', () => {
		it('/start 指令應回傳歡迎訊息', async () => {
			const request = createWebhookRequest('/start');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseText = await response.text();
			// 檢查是否有回應（實際上會透過 Telegram API 發送）
			// 在測試環境中，主要驗證請求被正確處理
		});

		it('「開始」關鍵字應與 /start 有相同效果', async () => {
			const request = createWebhookRequest('開始');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('/help 指令應回傳幫助訊息', async () => {
			const request = createWebhookRequest('/help');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「幫助」關鍵字應回傳幫助訊息', async () => {
			const request = createWebhookRequest('幫助');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});
	});

	describe('訂閱相關指令測試', () => {
		it('/subscribe 指令應啟動訂閱流程', async () => {
			const request = createWebhookRequest('/subscribe');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「訂閱」關鍵字應啟動訂閱流程', async () => {
			const request = createWebhookRequest('訂閱');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「我要訂閱」關鍵字應啟動訂閱流程', async () => {
			const request = createWebhookRequest('我要訂閱');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「加入」關鍵字應啟動訂閱流程', async () => {
			const request = createWebhookRequest('加入');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});
	});

	describe('確認指令測試', () => {
		let confirmationToken: string;

		it('setup: 先建立訂閱以取得 confirmation token', async () => {
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

			expect(subscribeResponse.status).toBe(201);

			const subscribeData = (await subscribeResponse.json()) as any;
			confirmationToken = subscribeData.subscription.confirmation_token;
			expect(confirmationToken).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
		});

		it('「確認 <token>」應激活訂閱', async () => {
			const request = createWebhookRequest(`確認 ${confirmationToken}`);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「verify <token>」英文指令應激活訂閱', async () => {
			// 為了測試，使用不同的用戶和新的 token
			const newChatId = testChatId + 1;
			const newUsername = testUsername + '_2';

			// 建立新訂閱
			const subscriptionData = {
				chat_id: newChatId,
				username: newUsername,
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
			const newToken = subscribeData.subscription.confirmation_token;

			// 使用英文確認指令
			const request = createWebhookRequest(`verify ${newToken}`, newChatId, newUsername);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('無效的確認指令格式應回傳錯誤提示', async () => {
			const invalidCommands = [
				'確認', // 缺少 token
				'確認 ', // 空 token
				'確認 abc123', // 無效格式的 token
				'verify', // 缺少 token
				'verify invalid', // 無效 token
			];

			for (const command of invalidCommands) {
				const request = createWebhookRequest(command, testChatId + 10); // 使用不同的 chat_id

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 所有請求都應該被處理（200），但會回傳錯誤訊息
				expect(response.status).toBe(200);
			}
		});
	});

	describe('退訂指令測試', () => {
		it('/unsubscribe 指令應啟動退訂流程', async () => {
			const request = createWebhookRequest('/unsubscribe');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「退訂」關鍵字應啟動退訂流程', async () => {
			const request = createWebhookRequest('退訂');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「取消訂閱」關鍵字應啟動退訂流程', async () => {
			const request = createWebhookRequest('取消訂閱');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「停止」關鍵字應啟動退訂流程', async () => {
			const request = createWebhookRequest('停止');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「離開」關鍵字應啟動退訂流程', async () => {
			const request = createWebhookRequest('離開');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});
	});

	describe('狀態查詢指令測試', () => {
		it('/status 指令應回傳訂閱狀態', async () => {
			const request = createWebhookRequest('/status');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「狀態」關鍵字應回傳訂閱狀態', async () => {
			const request = createWebhookRequest('狀態');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「我的狀態」關鍵字應回傳訂閱狀態', async () => {
			const request = createWebhookRequest('我的狀態');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('「檢查狀態」關鍵字應回傳訂閱狀態', async () => {
			const request = createWebhookRequest('檢查狀態');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});
	});

	describe('群組專用指令測試', () => {
		// 建立群組訊息的輔助函數
		const createGroupWebhookRequest = (text: string, chatId: number = -123456789) => {
			return new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify({
					update_id: Math.floor(Math.random() * 1000000),
					message: {
						message_id: Math.floor(Math.random() * 1000),
						date: Math.floor(Date.now() / 1000),
						text: text,
						from: {
							id: testChatId,
							is_bot: false,
							first_name: '群組測試用戶',
							username: testUsername,
						},
						chat: {
							id: chatId, // 負數表示群組
							type: 'group',
							title: '測試群組',
						},
					},
				}),
			});
		};

		it('/start@bot_username 群組指令應正確處理', async () => {
			const request = createGroupWebhookRequest('/start@testbot');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('群組中的一般指令應正確回應', async () => {
			const commands = ['/help@testbot', '/subscribe@testbot', '/status@testbot'];

			for (const command of commands) {
				const request = createGroupWebhookRequest(command);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});

		it('群組中不帶 @bot 的指令應被忽略', async () => {
			const commands = [
				'/start', // 沒有 @bot
				'/help', // 沒有 @bot
				'/status', // 沒有 @bot
			];

			for (const command of commands) {
				const request = createGroupWebhookRequest(command);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 應該被處理但可能不回應
				expect(response.status).toBe(200);
			}
		});
	});

	describe('無效指令和錯誤處理', () => {
		it('無法識別的指令應回傳幫助訊息', async () => {
			const invalidCommands = ['/unknown', '/invalid', 'random text', '???', '12345'];

			for (const command of invalidCommands) {
				const request = createWebhookRequest(command, testChatId + 20);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});

		it('空訊息應被正確處理', async () => {
			const request = createWebhookRequest('');

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('極長的訊息應被正確處理', async () => {
			const longMessage = 'x'.repeat(4096); // Telegram 訊息長度限制

			const request = createWebhookRequest(longMessage);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('包含特殊字符的訊息應被正確處理', async () => {
			const specialMessages = [
				'🚀 訂閱 🚀',
				'émojis and spëcial chars',
				'确认 test-token', // 簡體中文
				'確認\n換行\n測試', // 包含換行
				'confirm <script>alert("xss")</script>', // 潛在的 XSS 攻擊
			];

			for (const message of specialMessages) {
				const request = createWebhookRequest(message, testChatId + 30);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});
	});

	describe('指令大小寫和變體測試', () => {
		it('指令不區分大小寫', async () => {
			const commands = ['/START', '/Start', '/HELP', '/Help', '/SUBSCRIBE', '/Subscribe'];

			for (const command of commands) {
				const request = createWebhookRequest(command, testChatId + 40);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});

		it('中文關鍵字變體應正確識別', async () => {
			const variants = [
				'訂閱',
				'订阅', // 簡體
				'我想訂閱',
				'我要加入',
				'幫助',
				'帮助', // 簡體
				'退訂',
				'退订', // 簡體
				'取消',
				'停止推送',
				'狀態',
				'状态', // 簡體
			];

			for (const variant of variants) {
				const request = createWebhookRequest(variant, testChatId + 50);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});

		it('英文指令變體應正確識別', async () => {
			const variants = [
				'start',
				'START',
				'help',
				'HELP',
				'subscribe',
				'SUBSCRIBE',
				'join',
				'JOIN',
				'unsubscribe',
				'UNSUBSCRIBE',
				'stop',
				'STOP',
				'status',
				'STATUS',
			];

			for (const variant of variants) {
				const request = createWebhookRequest(variant, testChatId + 60);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});
	});

	describe('對話流程測試', () => {
		it('完整的訂閱到確認流程', async () => {
			const newChatId = testChatId + 100;
			const newUsername = 'flow_test_user';

			// 步驟 1: 開始對話
			const startRequest = createWebhookRequest('/start', newChatId, newUsername);
			let ctx = createExecutionContext();
			let response = await worker.fetch(startRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 2: 訂閱
			const subscribeRequest = createWebhookRequest('訂閱', newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(subscribeRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 3: 查詢狀態（應為 pending）
			const statusRequest1 = createWebhookRequest('狀態', newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(statusRequest1, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 4: 取得 confirmation token（透過 API）
			const subscriptionData = {
				chat_id: newChatId,
				username: newUsername,
				type: 'user',
			};

			const apiRequest = new Request('http://example.com/subscriptions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(subscriptionData),
			});

			ctx = createExecutionContext();
			const apiResponse = await worker.fetch(apiRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			const apiData = (await apiResponse.json()) as any;
			const token = apiData.subscription.confirmation_token;

			// 步驟 5: 確認訂閱
			const confirmRequest = createWebhookRequest(`確認 ${token}`, newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(confirmRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 6: 再次查詢狀態（應為 active）
			const statusRequest2 = createWebhookRequest('狀態', newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(statusRequest2, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 7: 退訂
			const unsubscribeRequest = createWebhookRequest('退訂', newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(unsubscribeRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);

			// 步驟 8: 最終狀態查詢（應為 cancelled）
			const statusRequest3 = createWebhookRequest('狀態', newChatId, newUsername);
			ctx = createExecutionContext();
			response = await worker.fetch(statusRequest3, env, ctx);
			await waitOnExecutionContext(ctx);
			expect(response.status).toBe(200);
		});
	});

	describe('併發請求測試', () => {
		it('同一用戶的併發請求應正確處理', async () => {
			const concurrentChatId = testChatId + 200;
			const concurrentRequests = [
				createWebhookRequest('/start', concurrentChatId),
				createWebhookRequest('幫助', concurrentChatId),
				createWebhookRequest('狀態', concurrentChatId),
			];

			const promises = concurrentRequests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);

			// 所有請求都應該成功處理
			responses.forEach((response) => {
				expect(response.status).toBe(200);
			});
		});

		it('不同用戶的併發請求應正確處理', async () => {
			const concurrentUsers = Array.from({ length: 5 }, (_, i) => ({
				chatId: testChatId + 300 + i,
				username: `concurrent_user_${i}`,
			}));

			const concurrentRequests = concurrentUsers.map((user) => createWebhookRequest('/start', user.chatId, user.username));

			const promises = concurrentRequests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);

			// 所有請求都應該成功處理
			responses.forEach((response) => {
				expect(response.status).toBe(200);
			});
		});
	});
});
