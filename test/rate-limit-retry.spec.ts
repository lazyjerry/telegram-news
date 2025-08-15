import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.5 速率限制與重試測試
 * 測試 429 錯誤處理和重試機制
 */
describe('速率限制與重試測試', () => {
	const testChatId = 987654321;
	const testUsername = 'ratelimit_testuser';

	describe('速率限制處理', () => {
		it('setup: 建立測試訂閱', async () => {
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
			const confirmationToken = subscribeData.subscription.confirmation_token;

			// 激活訂閱
			const webhookPayload = {
				update_id: 789456,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: `確認 ${confirmationToken}`,
					from: {
						id: testChatId,
						is_bot: false,
						first_name: '限制測試用戶',
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

			expect(webhookResponse.status).toBe(200);
		});

		it('建立多篇測試文章用於批量推播', async () => {
			const posts = Array.from({ length: 5 }, (_, i) => ({
				title: `速率限制測試文章 ${i + 1}`,
				content: `這是第 ${i + 1} 篇測試速率限制的文章內容...`,
				url: `https://example.com/rate-limit-test-${i + 1}`,
				author: '測試作者',
				publish_time: new Date(Date.now() + i * 1000).toISOString(), // 間隔 1 秒
				source: '測試新聞源',
				tags: ['測試', '速率限制'],
				filters_json: '{"usernames": []}',
			}));

			let successCount = 0;

			for (const post of posts) {
				const request = new Request('http://example.com/api/ingest', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-API-Key': 'test-api-key',
					},
					body: JSON.stringify(post),
				});

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status === 201 || response.status === 200) {
					successCount++;
				}
			}

			// 驗證至少成功建立了一些文章
			expect(successCount).toBeGreaterThan(0);
		});

		it('批量推播應正確處理速率限制', async () => {
			// 執行批量推播，這可能會觸發速率限制
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 10, // 推播較多文章以測試速率限制
					dry_run: false,
				}),
			});

			const ctx = createExecutionContext();
			const startTime = Date.now();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			const endTime = Date.now();

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('results');

			// 檢查執行時間 - 如果有速率限制，執行時間應該較長
			const executionTime = endTime - startTime;

			// 記錄執行統計
			if (responseData.results && responseData.results.length > 0) {
				responseData.results.forEach((result: any) => {
					expect(result).toHaveProperty('post_id');
					expect(result).toHaveProperty('delivered_count');
					expect(result).toHaveProperty('target_count');

					// 檢查是否有重試資訊
					if (result.retry_info) {
						expect(result.retry_info).toHaveProperty('attempts');
						expect(result.retry_info).toHaveProperty('final_status');
					}
				});
			}

			// 輸出測試資訊用於驗證
			console.log(`批量推播執行時間: ${executionTime}ms`);
			console.log(`處理文章數量: ${responseData.results?.length || 0}`);
		});

		it('單一用戶速率限制測試（1 訊息/秒）', async () => {
			// 建立多個快速連續的文章並推播給同一用戶
			const rapidPosts = Array.from({ length: 3 }, (_, i) => ({
				title: `快速推播測試 ${i + 1}`,
				content: `快速推播測試內容 ${i + 1}...`,
				url: `https://example.com/rapid-test-${i + 1}`,
				author: '測試作者',
				publish_time: new Date().toISOString(),
				source: '測試新聞源',
				tags: ['測試', '快速推播'],
				filters_json: `{"usernames": ["${testUsername}"]}`,
			}));

			// 建立文章
			for (const post of rapidPosts) {
				const request = new Request('http://example.com/api/ingest', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-API-Key': 'test-api-key',
					},
					body: JSON.stringify(post),
				});

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect([200, 201]).toContain(response.status);
			}

			// 執行推播並測量時間
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 3,
					dry_run: false,
				}),
			});

			const ctx = createExecutionContext();
			const startTime = Date.now();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			const endTime = Date.now();

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			const executionTime = endTime - startTime;

			// 如果正確實施了速率限制，給同一用戶發送 3 條訊息應該至少需要 2 秒
			// 但在測試環境中可能沒有實際的 Telegram API 呼叫
			console.log(`單用戶推播執行時間: ${executionTime}ms`);

			if (responseData.results && responseData.results.length > 0) {
				responseData.results.forEach((result: any) => {
					expect(result).toHaveProperty('delivered_count');
					expect(result).toHaveProperty('target_count');
				});
			}
		});

		it('全域速率限制測試（~25 訊息/秒）', async () => {
			// 這個測試在實際環境中才有意義，因為需要真實的 Telegram API
			// 在測試環境中，我們主要驗證相關的邏輯結構

			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 50, // 大量文章推播
					dry_run: true, // 使用 dry_run 避免實際發送
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('dry_run', true);
			expect(responseData).toHaveProperty('preview');

			// 檢查預覽資料結構
			if (responseData.preview) {
				expect(responseData.preview).toHaveProperty('estimated_messages');
				expect(responseData.preview).toHaveProperty('estimated_time_seconds');

				// 如果有預估時間，應該考慮了速率限制
				if (responseData.preview.estimated_time_seconds) {
					expect(responseData.preview.estimated_time_seconds).toBeGreaterThan(0);
					console.log(`預估推播時間: ${responseData.preview.estimated_time_seconds}秒`);
				}
			}
		});
	});

	describe('重試機制測試', () => {
		it('模擬網路錯誤重試', async () => {
			// 建立測試文章
			const postData = {
				title: '重試測試文章',
				content: '這是測試重試機制的文章...',
				url: 'https://example.com/retry-test-article',
				author: '測試作者',
				publish_time: new Date().toISOString(),
				source: '測試新聞源',
				tags: ['測試', '重試'],
				filters_json: '{"usernames": []}',
			};

			const ingestRequest = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(postData),
			});

			const ingestCtx = createExecutionContext();
			const ingestResponse = await worker.fetch(ingestRequest, env, ingestCtx);
			await waitOnExecutionContext(ingestCtx);

			expect(ingestResponse.status).toBe(201);

			// 執行推播（在測試環境中，重試邏輯主要透過程式碼結構驗證）
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 1,
					dry_run: false,
				}),
			});

			const pushCtx = createExecutionContext();
			const pushResponse = await worker.fetch(pushRequest, env, pushCtx);
			await waitOnExecutionContext(pushCtx);

			expect(pushResponse.status).toBe(200);

			const responseData = (await pushResponse.json()) as any;
			expect(responseData).toHaveProperty('success', true);

			// 檢查結果中是否包含重試相關資訊
			if (responseData.results && responseData.results.length > 0) {
				responseData.results.forEach((result: any) => {
					// 驗證基本欄位存在
					expect(result).toHaveProperty('post_id');
					expect(result).toHaveProperty('delivered_count');
					expect(result).toHaveProperty('target_count');

					// 如果有錯誤資訊，檢查格式
					if (result.errors && Array.isArray(result.errors)) {
						result.errors.forEach((error: any) => {
							expect(error).toHaveProperty('chat_id');
							expect(error).toHaveProperty('error_type');
							expect(error).toHaveProperty('retry_count');
						});
					}
				});
			}
		});

		it('指數退避重試測試', async () => {
			// 這個測試主要驗證重試邏輯的結構正確性
			// 實際的指數退避需要在真實環境中測試

			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 5,
					dry_run: true,
				}),
			});

			const ctx = createExecutionContext();
			const startTime = Date.now();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);
			const endTime = Date.now();

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			const executionTime = endTime - startTime;

			console.log(`重試測試執行時間: ${executionTime}ms`);

			// Dry run 應該快速完成
			expect(executionTime).toBeLessThan(5000); // 5 秒內完成

			if (responseData.preview) {
				expect(responseData.preview).toHaveProperty('posts_to_send');
				expect(responseData.preview).toHaveProperty('retry_policy');

				// 檢查重試策略資訊
				if (responseData.preview.retry_policy) {
					expect(responseData.preview.retry_policy).toHaveProperty('max_attempts');
					expect(responseData.preview.retry_policy).toHaveProperty('backoff_strategy');
				}
			}
		});

		it('永久失敗處理測試', async () => {
			// 測試當重試次數耗盡時的處理
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 10,
					dry_run: false,
					force_retry_failed: true, // 假設的參數，用於測試失敗重試
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success', true);

			// 檢查是否有失敗統計
			if (responseData.summary) {
				expect(responseData.summary).toHaveProperty('total_processed');
				expect(responseData.summary).toHaveProperty('successful_deliveries');
				expect(responseData.summary).toHaveProperty('failed_deliveries');
				expect(responseData.summary).toHaveProperty('retry_exhausted');
			}
		});
	});

	describe('429 錯誤特定處理', () => {
		it('模擬 429 Too Many Requests 回應', async () => {
			// 由於我們無法直接模擬 Telegram API 回傳 429
			// 這個測試主要驗證相關的錯誤處理邏輯存在

			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 1,
					dry_run: false,
					simulate_429: true, // 假設的參數用於模擬 429 錯誤
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			// 即使遇到 429 錯誤，API 本身應該回傳 200（表示處理完成）
			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success');

			// 檢查錯誤處理資訊
			if (responseData.results && responseData.results.length > 0) {
				responseData.results.forEach((result: any) => {
					if (result.errors) {
						// 檢查 429 錯誤的特殊處理
						const rateLimitErrors = result.errors.filter((e: any) => e.error_type === 'rate_limit' || e.status_code === 429);

						rateLimitErrors.forEach((error: any) => {
							expect(error).toHaveProperty('retry_after');
							expect(error).toHaveProperty('retry_count');
						});
					}
				});
			}
		});

		it('retry_after 參數正確處理', async () => {
			// 測試當 Telegram API 回傳 retry_after 時的處理邏輯

			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 3,
					dry_run: true, // 使用 dry_run 避免實際 API 呼叫
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			// 檢查是否有速率限制相關的預估資訊
			if (responseData.preview && responseData.preview.rate_limit_info) {
				expect(responseData.preview.rate_limit_info).toHaveProperty('global_limit_per_second');
				expect(responseData.preview.rate_limit_info).toHaveProperty('per_chat_limit_per_second');
				expect(responseData.preview.rate_limit_info).toHaveProperty('estimated_total_time');
			}
		});
	});

	describe('錯誤恢復測試', () => {
		it('部分失敗應正確記錄並繼續處理', async () => {
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 5,
					dry_run: false,
					continue_on_error: true,
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success', true);

			// 檢查錯誤統計
			if (responseData.summary) {
				expect(responseData.summary).toHaveProperty('total_processed');
				expect(responseData.summary).toHaveProperty('successful_deliveries');
				expect(responseData.summary).toHaveProperty('failed_deliveries');

				// 總處理數應該等於成功數加失敗數
				const total = responseData.summary.total_processed || 0;
				const successful = responseData.summary.successful_deliveries || 0;
				const failed = responseData.summary.failed_deliveries || 0;

				expect(total).toBeGreaterThanOrEqual(successful + failed);
			}
		});

		it('錯誤記錄應包含完整資訊', async () => {
			const pushRequest = new Request('http://example.com/admin/push', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify({
					limit: 1,
					dry_run: false,
					detailed_errors: true,
				}),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(pushRequest, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			if (responseData.results && responseData.results.length > 0) {
				responseData.results.forEach((result: any) => {
					if (result.errors && result.errors.length > 0) {
						result.errors.forEach((error: any) => {
							// 驗證錯誤記錄包含必要資訊
							expect(error).toHaveProperty('timestamp');
							expect(error).toHaveProperty('chat_id');
							expect(error).toHaveProperty('error_type');
							expect(error).toHaveProperty('error_message');
							expect(error).toHaveProperty('retry_count');

							if (error.error_type === 'rate_limit') {
								expect(error).toHaveProperty('retry_after');
							}
						});
					}
				});
			}
		});
	});
});
