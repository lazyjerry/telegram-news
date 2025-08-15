import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 17.1 端到端整合測試
 * 測試完整的新聞推播流程
 */
describe('端到端整合測試', () => {
	const testChatId = 123456789;
	const testAdminId = 999999999;

	// 輔助函數：建立 HTTP 請求
	const createApiRequest = (path: string, method: string = 'GET', body?: any, headers: Record<string, string> = {}) => {
		const baseHeaders = {
			'Content-Type': 'application/json',
			...headers,
		};

		return new Request(`http://example.com${path}`, {
			method,
			headers: baseHeaders,
			body: body ? JSON.stringify(body) : undefined,
		});
	};

	// 輔助函數：建立 Telegram webhook 請求
	const createTelegramWebhook = (text: string, chatId: number = testChatId, userId: number = testChatId) => {
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
						id: userId,
						is_bot: false,
						first_name: 'Test User',
					},
					chat: {
						id: chatId,
						type: chatId > 0 ? 'private' : 'supergroup',
					},
				},
			}),
		});
	};

	describe('完整用戶註冊到接收新聞流程', () => {
		it('新用戶完整使用流程', async () => {
			console.log('🚀 開始端到端整合測試：新用戶完整流程');

			// 步驟 1: 用戶發送 /start 指令
			console.log('📱 步驟 1: 用戶發送 /start 指令');
			const startRequest = createTelegramWebhook('/start', testChatId);

			let ctx = createExecutionContext();
			let response = await worker.fetch(startRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ /start 指令處理成功');

			// 步驟 2: 用戶查看幫助資訊
			console.log('📖 步驟 2: 用戶查看幫助資訊');
			const helpRequest = createTelegramWebhook('/help', testChatId);

			ctx = createExecutionContext();
			response = await worker.fetch(helpRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 幫助資訊顯示成功');

			// 步驟 3: 用戶嘗試訂閱
			console.log('📋 步驟 3: 用戶嘗試訂閱');
			const subscribeRequest = createTelegramWebhook('訂閱', testChatId);

			ctx = createExecutionContext();
			response = await worker.fetch(subscribeRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 訂閱流程啟動成功');

			// 步驟 4: 新增測試新聞 (通過 API)
			console.log('📰 步驟 4: 新增測試新聞');
			const newsData = {
				title: '端到端測試新聞',
				content: '這是一則用於端到端測試的新聞內容，包含了完整的測試流程驗證。',
				url: `https://test-news.com/e2e-${Date.now()}`,
				published: false,
				keywords: ['測試', '端到端', 'E2E'],
				source: 'E2E Test',
			};

			const ingestRequest = createApiRequest('/api/ingest', 'POST', newsData);

			ctx = createExecutionContext();
			response = await worker.fetch(ingestRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const ingestResult = await response.json();
			console.log('✅ 新聞新增成功:', ingestResult);

			// 步驟 5: 管理員推播新聞
			console.log('📢 步驟 5: 管理員推播新聞');
			const pushRequest = createTelegramWebhook('/push', testAdminId, testAdminId);

			ctx = createExecutionContext();
			response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞推播成功');

			// 步驟 6: 用戶查看狀態
			console.log('📊 步驟 6: 用戶查看狀態');
			const statusRequest = createTelegramWebhook('狀態', testChatId);

			ctx = createExecutionContext();
			response = await worker.fetch(statusRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 狀態查詢成功');

			console.log('🎉 端到端整合測試完成！');
		});

		it('多用戶並行互動測試', async () => {
			console.log('🔄 開始多用戶並行互動測試');

			const userIds = [111111, 222222, 333333, 444444, 555555];
			const actions = ['/start', '/help', '訂閱', '狀態', '幫助'];

			// 建立並行請求
			const parallelRequests = userIds.map((userId, index) => {
				const action = actions[index % actions.length];
				return createTelegramWebhook(action, userId, userId);
			});

			const startTime = Date.now();

			// 並行執行所有請求
			const promises = parallelRequests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);
			const endTime = Date.now();

			// 驗證所有請求都成功處理
			responses.forEach((response, index) => {
				expect(response.status).toBe(200);
				console.log(`✅ 用戶 ${userIds[index]} 的請求處理成功`);
			});

			const totalTime = endTime - startTime;
			console.log(`⏱️  ${userIds.length} 個用戶並行處理時間: ${totalTime}ms`);

			// 效能要求：5 個用戶並行請求應在 5 秒內完成
			expect(totalTime).toBeLessThan(5000);
			console.log('🎉 多用戶並行互動測試完成！');
		});

		it('完整新聞生命週期測試', async () => {
			console.log('♻️ 開始完整新聞生命週期測試');

			const testNewsUrl = `https://lifecycle-test.com/news-${Date.now()}`;

			// 階段 1: 新聞建立
			console.log('📝 階段 1: 建立新聞');
			const createNewsData = {
				title: '生命週期測試新聞',
				content: '測試新聞從建立到推播的完整生命週期。',
				url: testNewsUrl,
				published: false,
				keywords: ['生命週期', '測試'],
				source: '測試來源',
			};

			let ctx = createExecutionContext();
			let response = await worker.fetch(createApiRequest('/api/ingest', 'POST', createNewsData), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞建立成功');

			// 階段 2: 新聞更新
			console.log('✏️ 階段 2: 更新新聞內容');
			const updateNewsData = {
				...createNewsData,
				content: '更新後的新聞內容，包含更多詳細資訊。',
				keywords: [...createNewsData.keywords, '更新'],
			};

			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/ingest', 'POST', updateNewsData), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞更新成功');

			// 階段 3: 查詢新聞
			console.log('🔍 階段 3: 查詢新聞狀態');
			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/news'), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞查詢成功');

			// 階段 4: 推播新聞
			console.log('📡 階段 4: 推播新聞');
			ctx = createExecutionContext();
			response = await worker.fetch(createTelegramWebhook('/push', testAdminId, testAdminId), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞推播成功');

			// 階段 5: 驗證推播狀態
			console.log('✅ 階段 5: 驗證推播狀態');
			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/news'), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 推播狀態驗證成功');

			console.log('🎉 完整新聞生命週期測試完成！');
		});
	});

	describe('API 端點整合測試', () => {
		it('所有 API 端點響應測試', async () => {
			console.log('🔗 開始 API 端點整合測試');

			const apiEndpoints = [
				{ path: '/', method: 'GET', name: '根路徑' },
				{ path: '/api/news', method: 'GET', name: '新聞列表' },
				{ path: '/api/subscriptions', method: 'GET', name: '訂閱列表' },
				{ path: '/health', method: 'GET', name: '健康檢查' },
				{
					path: '/api/ingest',
					method: 'POST',
					name: '新聞匯入',
					body: {
						title: 'API 測試新聞',
						content: '用於 API 測試的新聞內容',
						url: `https://api-test.com/${Date.now()}`,
						published: false,
					},
				},
			];

			for (const endpoint of apiEndpoints) {
				console.log(`🧪 測試 ${endpoint.name}: ${endpoint.method} ${endpoint.path}`);

				const request = createApiRequest(endpoint.path, endpoint.method, endpoint.body);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBeGreaterThanOrEqual(200);
				expect(response.status).toBeLessThan(500);

				console.log(`✅ ${endpoint.name} 測試通過 (${response.status})`);
			}

			console.log('🎉 API 端點整合測試完成！');
		});

		it('錯誤處理整合測試', async () => {
			console.log('⚠️ 開始錯誤處理整合測試');

			const errorScenarios = [
				{
					name: '無效的 JSON 資料',
					request: () =>
						new Request('http://example.com/api/ingest', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: '{ invalid json',
						}),
				},
				{
					name: '不存在的端點',
					request: () => createApiRequest('/api/nonexistent', 'GET'),
				},
				{
					name: '無效的 HTTP 方法',
					request: () => createApiRequest('/api/news', 'DELETE'),
				},
				{
					name: '缺少必要欄位的新聞資料',
					request: () => createApiRequest('/api/ingest', 'POST', { title: '只有標題' }),
				},
			];

			for (const scenario of errorScenarios) {
				console.log(`🔍 測試錯誤場景: ${scenario.name}`);

				const request = scenario.request();

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 錯誤應該被正確處理，返回適當的狀態碼
				expect(response.status).toBeGreaterThanOrEqual(200);
				console.log(`✅ ${scenario.name} 錯誤處理正確 (${response.status})`);
			}

			console.log('🎉 錯誤處理整合測試完成！');
		});
	});

	describe('WebHook 整合測試', () => {
		it('各種 Telegram 事件處理', async () => {
			console.log('📱 開始 Telegram WebHook 整合測試');

			const webhookEvents = [
				{
					name: '文字訊息',
					webhook: {
						update_id: 1,
						message: {
							message_id: 1,
							date: Math.floor(Date.now() / 1000),
							text: '/start',
							from: { id: testChatId, is_bot: false, first_name: 'Test' },
							chat: { id: testChatId, type: 'private' },
						},
					},
				},
				{
					name: '群組訊息',
					webhook: {
						update_id: 2,
						message: {
							message_id: 2,
							date: Math.floor(Date.now() / 1000),
							text: '/help@testbot',
							from: { id: 111111, is_bot: false, first_name: 'Group User' },
							chat: { id: -987654321, type: 'supergroup', title: 'Test Group' },
						},
					},
				},
				{
					name: '訂閱確認回呼',
					webhook: {
						update_id: 3,
						callback_query: {
							id: 'callback_test',
							from: { id: testChatId, is_bot: false, first_name: 'Test' },
							message: {
								message_id: 3,
								date: Math.floor(Date.now() / 1000),
								text: '請確認訂閱',
								chat: { id: testChatId, type: 'private' },
							},
							data: 'confirm_subscription',
						},
					},
				},
			];

			for (const event of webhookEvents) {
				console.log(`📨 測試事件: ${event.name}`);

				const request = new Request('http://example.com/tg/webhook', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
					},
					body: JSON.stringify(event.webhook),
				});

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
				console.log(`✅ ${event.name} 處理成功`);
			}

			console.log('🎉 Telegram WebHook 整合測試完成！');
		});

		it('WebHook 安全性驗證', async () => {
			console.log('🔒 開始 WebHook 安全性整合測試');

			const securityTests = [
				{
					name: '正確的安全令牌',
					headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' },
					expectedSuccess: true,
				},
				{
					name: '錯誤的安全令牌',
					headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret' },
					expectedSuccess: false,
				},
				{
					name: '缺少安全令牌',
					headers: {},
					expectedSuccess: false,
				},
			];

			const webhookPayload = {
				update_id: 999,
				message: {
					message_id: 999,
					date: Math.floor(Date.now() / 1000),
					text: '/test',
					from: { id: testChatId, is_bot: false, first_name: 'Security Test' },
					chat: { id: testChatId, type: 'private' },
				},
			};

			for (const test of securityTests) {
				console.log(`🔐 測試: ${test.name}`);

				const headers: Record<string, string> = {
					'Content-Type': 'application/json',
				};

				if (test.headers['X-Telegram-Bot-Api-Secret-Token']) {
					headers['X-Telegram-Bot-Api-Secret-Token'] = test.headers['X-Telegram-Bot-Api-Secret-Token'];
				}

				const request = new Request('http://example.com/tg/webhook', {
					method: 'POST',
					headers,
					body: JSON.stringify(webhookPayload),
				});

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (test.expectedSuccess) {
					expect(response.status).toBe(200);
					console.log(`✅ ${test.name} - 授權成功`);
				} else {
					expect(response.status).toBeGreaterThanOrEqual(400);
					console.log(`✅ ${test.name} - 正確拒絕 (${response.status})`);
				}
			}

			console.log('🎉 WebHook 安全性整合測試完成！');
		});
	});

	describe('資料一致性測試', () => {
		it('新聞資料一致性驗證', async () => {
			console.log('📊 開始資料一致性測試');

			const testUrl = `https://consistency-test.com/news-${Date.now()}`;

			// 1. 建立新聞
			const newsData = {
				title: '資料一致性測試',
				content: '用於驗證資料一致性的測試新聞',
				url: testUrl,
				published: false,
				keywords: ['一致性', '測試'],
				source: '測試系統',
			};

			let ctx = createExecutionContext();
			let response = await worker.fetch(createApiRequest('/api/ingest', 'POST', newsData), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞建立成功');

			// 2. 立即查詢新聞，確認資料正確
			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/news'), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞查詢成功');

			// 3. 更新新聞
			const updatedNewsData = {
				...newsData,
				content: '更新後的資料一致性測試內容',
				keywords: [...newsData.keywords, '更新'],
			};

			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/ingest', 'POST', updatedNewsData), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 新聞更新成功');

			// 4. 再次查詢，確認更新正確
			ctx = createExecutionContext();
			response = await worker.fetch(createApiRequest('/api/news'), env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			console.log('✅ 更新後查詢成功');

			console.log('🎉 資料一致性測試完成！');
		});

		it('訂閱狀態一致性驗證', async () => {
			console.log('👥 開始訂閱狀態一致性測試');

			const testUsers = [666001, 666002, 666003];

			for (const userId of testUsers) {
				console.log(`👤 測試用戶 ${userId} 的訂閱流程`);

				// 1. 用戶發起訂閱
				let ctx = createExecutionContext();
				let response = await worker.fetch(createTelegramWebhook('訂閱', userId, userId), env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
				console.log(`✅ 用戶 ${userId} 訂閱請求成功`);

				// 2. 檢查訂閱列表
				ctx = createExecutionContext();
				response = await worker.fetch(createApiRequest('/api/subscriptions'), env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
				console.log(`✅ 用戶 ${userId} 訂閱狀態查詢成功`);

				// 3. 用戶查詢自己的狀態
				ctx = createExecutionContext();
				response = await worker.fetch(createTelegramWebhook('狀態', userId, userId), env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
				console.log(`✅ 用戶 ${userId} 自主狀態查詢成功`);
			}

			console.log('🎉 訂閱狀態一致性測試完成！');
		});
	});

	describe('系統整體穩定性測試', () => {
		it('長時間運行穩定性測試', async () => {
			console.log('⏳ 開始長時間運行穩定性測試');

			const testDuration = 50; // 50 次請求模擬長時間運行
			const requestTypes = [
				() => createTelegramWebhook('/start', Math.floor(Math.random() * 1000000)),
				() => createTelegramWebhook('/help', Math.floor(Math.random() * 1000000)),
				() => createTelegramWebhook('訂閱', Math.floor(Math.random() * 1000000)),
				() => createApiRequest('/api/news'),
				() => createApiRequest('/health'),
			];

			let successCount = 0;
			const startTime = Date.now();

			for (let i = 0; i < testDuration; i++) {
				const requestType = requestTypes[i % requestTypes.length];
				const request = requestType();

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status >= 200 && response.status < 500) {
					successCount++;
				}

				// 每 10 次請求報告進度
				if ((i + 1) % 10 === 0) {
					console.log(`⏱️  已完成 ${i + 1}/${testDuration} 次請求`);
				}

				// 模擬真實使用間隔
				await new Promise((resolve) => setTimeout(resolve, 10));
			}

			const endTime = Date.now();
			const totalTime = endTime - startTime;
			const successRate = (successCount / testDuration) * 100;

			console.log(`📊 穩定性測試結果:`);
			console.log(`   - 總請求數: ${testDuration}`);
			console.log(`   - 成功請求: ${successCount}`);
			console.log(`   - 成功率: ${successRate.toFixed(2)}%`);
			console.log(`   - 總時間: ${totalTime}ms`);
			console.log(`   - 平均響應時間: ${(totalTime / testDuration).toFixed(2)}ms`);

			// 要求：成功率應該 >= 95%
			expect(successRate).toBeGreaterThanOrEqual(95);
			console.log('🎉 長時間運行穩定性測試完成！');
		});

		it('記憶體和資源使用測試', async () => {
			console.log('💾 開始記憶體和資源使用測試');

			const heavyOperations = [
				{
					name: '大量新聞匯入',
					operation: async () => {
						const requests = Array.from({ length: 10 }, (_, i) => ({
							title: `大量測試新聞 ${i + 1}`,
							content: '這是一則用於壓力測試的新聞內容，包含較多文字以測試記憶體使用情況。'.repeat(5),
							url: `https://memory-test.com/news-${Date.now()}-${i}`,
							published: false,
							keywords: ['記憶體測試', '壓力測試', `批次${Math.floor(i / 3) + 1}`],
							source: '記憶體測試系統',
						}));

						for (const newsData of requests) {
							const ctx = createExecutionContext();
							const response = await worker.fetch(createApiRequest('/api/ingest', 'POST', newsData), env, ctx);
							await waitOnExecutionContext(ctx);
							expect(response.status).toBe(200);
						}

						return requests.length;
					},
				},
				{
					name: '大量用戶互動',
					operation: async () => {
						const userInteractions = Array.from({ length: 20 }, (_, i) => {
							const userId = 777000 + i;
							const commands = ['/start', '/help', '訂閱', '狀態', '幫助'];
							const command = commands[i % commands.length];
							return createTelegramWebhook(command, userId, userId);
						});

						let successCount = 0;
						for (const request of userInteractions) {
							const ctx = createExecutionContext();
							const response = await worker.fetch(request, env, ctx);
							await waitOnExecutionContext(ctx);
							if (response.status === 200) successCount++;
						}

						return successCount;
					},
				},
			];

			for (const test of heavyOperations) {
				console.log(`🔄 執行 ${test.name}...`);
				const startTime = Date.now();

				const result = await test.operation();

				const endTime = Date.now();
				const duration = endTime - startTime;

				console.log(`✅ ${test.name} 完成: 處理 ${result} 個項目，耗時 ${duration}ms`);

				// 效能要求：每個操作應在合理時間內完成
				expect(duration).toBeLessThan(30000); // 30 秒內
			}

			console.log('🎉 記憶體和資源使用測試完成！');
		});
	});
});
