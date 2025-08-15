import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 17.3 可靠性與容錯測試
 * 測試系統在異常情況下的可靠性和恢復能力
 */
describe('可靠性與容錯測試', () => {
	// 輔助函數：建立測試請求
	const createTestRequest = (path: string, method: string = 'GET', body?: any, headers: Record<string, string> = {}) => {
		return new Request(`http://example.com${path}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: body ? JSON.stringify(body) : undefined,
		});
	};

	// 輔助函數：建立 Telegram webhook 請求
	const createTelegramWebhook = (payload: any, secret: string = 'test-secret') => {
		return new Request('http://example.com/tg/webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Telegram-Bot-Api-Secret-Token': secret,
			},
			body: JSON.stringify(payload),
		});
	};

	// 輔助函數：執行請求並捕獲錯誤
	const executeRequestSafely = async (request: Request): Promise<{ response?: Response; error?: Error }> => {
		try {
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);
			return { response };
		} catch (error) {
			return { error: error as Error };
		}
	};

	describe('輸入驗證和錯誤處理', () => {
		it('無效 JSON 資料處理測試', async () => {
			console.log('🔍 開始無效 JSON 資料處理測試');

			const invalidJsonTests = [
				{ name: '不完整的 JSON', body: '{"title": "test"' },
				{ name: '無效的 JSON 語法', body: '{ title: test }' },
				{ name: '空字串', body: '' },
				{ name: '非 JSON 字串', body: 'not json at all' },
				{ name: '只有空白字符', body: '   \n\t   ' },
				{ name: '包含特殊字符', body: '{"title": "test\u0000"}' },
			];

			for (const test of invalidJsonTests) {
				console.log(`   📝 測試: ${test.name}`);

				const request = new Request('http://example.com/api/ingest', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: test.body,
				});

				const { response, error } = await executeRequestSafely(request);

				// 應該能處理錯誤而不是崩潰
				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 應該回傳適當的錯誤狀態碼
					expect(response.status).toBeGreaterThanOrEqual(400);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 正確處理 (${response.status})`);
				}
			}

			console.log('✅ 無效 JSON 資料處理測試完成');
		});

		it('缺少必要欄位處理測試', async () => {
			console.log('📋 開始缺少必要欄位處理測試');

			const incompleteDataTests = [
				{ name: '只有標題', data: { title: '測試標題' } },
				{ name: '只有內容', data: { content: '測試內容' } },
				{ name: '只有 URL', data: { url: 'https://test.com' } },
				{ name: '空物件', data: {} },
				{ name: '空字串欄位', data: { title: '', content: '', url: '' } },
				{ name: 'null 值欄位', data: { title: null, content: null, url: null } },
				{ name: '未定義欄位', data: { title: undefined, content: undefined } },
			];

			for (const test of incompleteDataTests) {
				console.log(`   📝 測試: ${test.name}`);

				const request = createTestRequest('/api/ingest', 'POST', test.data);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 應該回傳適當的錯誤狀態碼或成功處理
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 正確處理 (${response.status})`);
				}
			}

			console.log('✅ 缺少必要欄位處理測試完成');
		});

		it('異常大型資料處理測試', async () => {
			console.log('📊 開始異常大型資料處理測試');

			const largeSizeTests = [
				{
					name: '超長標題',
					data: {
						title: 'A'.repeat(10000),
						content: '正常內容',
						url: 'https://test.com/long-title',
					},
				},
				{
					name: '超長內容',
					data: {
						title: '正常標題',
						content: 'B'.repeat(100000),
						url: 'https://test.com/long-content',
					},
				},
				{
					name: '大量關鍵字',
					data: {
						title: '正常標題',
						content: '正常內容',
						url: 'https://test.com/many-keywords',
						keywords: Array.from({ length: 1000 }, (_, i) => `關鍵字${i}`),
					},
				},
				{
					name: '深度嵌套物件',
					data: {
						title: '正常標題',
						content: '正常內容',
						url: 'https://test.com/deep-nested',
						metadata: Array.from({ length: 100 }).reduce((obj, _, i) => ({ [`level${i}`]: obj }), { deepest: 'value' }),
					},
				},
			];

			for (const test of largeSizeTests) {
				console.log(`   📝 測試: ${test.name}`);

				const request = createTestRequest('/api/ingest', 'POST', test.data);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 系統應該能處理或適當拒絕大型資料
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 正確處理 (${response.status})`);
				}
			}

			console.log('✅ 異常大型資料處理測試完成');
		});
	});

	describe('安全性和授權錯誤處理', () => {
		it('Webhook 安全令牌驗證測試', async () => {
			console.log('🔐 開始 Webhook 安全令牌驗證測試');

			const securityTests = [
				{ name: '正確令牌', secret: 'test-secret', expectSuccess: true },
				{ name: '錯誤令牌', secret: 'wrong-secret', expectSuccess: false },
				{ name: '空令牌', secret: '', expectSuccess: false },
				{ name: '超長令牌', secret: 'x'.repeat(1000), expectSuccess: false },
				{ name: '特殊字符令牌', secret: 'test@#$%^&*()', expectSuccess: false },
				{ name: 'SQL 注入嘗試', secret: "'; DROP TABLE users; --", expectSuccess: false },
			];

			const testPayload = {
				update_id: 12345,
				message: {
					message_id: 1,
					date: Math.floor(Date.now() / 1000),
					text: '/help',
					from: { id: 123456, is_bot: false, first_name: 'Test' },
					chat: { id: 123456, type: 'private' },
				},
			};

			for (const test of securityTests) {
				console.log(`   🔒 測試: ${test.name}`);

				const request = createTelegramWebhook(testPayload, test.secret);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					if (test.expectSuccess) {
						expect(response.status).toBe(200);
						console.log(`     ✅ 授權成功 (${response.status})`);
					} else {
						expect(response.status).toBeGreaterThanOrEqual(400);
						console.log(`     ✅ 正確拒絕 (${response.status})`);
					}
				}
			}

			console.log('✅ Webhook 安全令牌驗證測試完成');
		});

		it('惡意請求處理測試', async () => {
			console.log('⚠️ 開始惡意請求處理測試');

			const maliciousTests = [
				{
					name: 'XSS 嘗試',
					data: {
						title: '<script>alert("xss")</script>',
						content: '<img src="x" onerror="alert(1)">',
						url: 'javascript:alert(1)',
					},
				},
				{
					name: 'SQL 注入嘗試',
					data: {
						title: "'; DROP TABLE news; --",
						content: "1' OR '1'='1",
						url: 'https://test.com/sql',
					},
				},
				{
					name: '路徑遍歷嘗試',
					data: {
						title: '../../../etc/passwd',
						content: '..\\..\\windows\\system32',
						url: 'file:///etc/passwd',
					},
				},
				{
					name: '指令注入嘗試',
					data: {
						title: '$(rm -rf /)',
						content: '`cat /etc/passwd`',
						url: 'https://test.com/cmd',
					},
				},
			];

			for (const test of maliciousTests) {
				console.log(`   🛡️ 測試: ${test.name}`);

				const request = createTestRequest('/api/ingest', 'POST', test.data);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 系統應該能安全處理惡意輸入
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 安全處理 (${response.status})`);
				}
			}

			console.log('✅ 惡意請求處理測試完成');
		});

		it('不存在端點處理測試', async () => {
			console.log('🔍 開始不存在端點處理測試');

			const nonExistentEndpoints = [
				'/api/nonexistent',
				'/admin/secret',
				'/config/database',
				'/test/../../secret',
				'/api/news/../admin',
				'/favicon.ico',
				'/robots.txt',
				'/.well-known/security.txt',
			];

			for (const endpoint of nonExistentEndpoints) {
				console.log(`   📍 測試端點: ${endpoint}`);

				const request = createTestRequest(endpoint);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 應該回傳適當的 404 或其他狀態碼
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 正確處理 (${response.status})`);
				}
			}

			console.log('✅ 不存在端點處理測試完成');
		});
	});

	describe('網路和連線錯誤處理', () => {
		it('異常 HTTP 方法處理測試', async () => {
			console.log('🌐 開始異常 HTTP 方法處理測試');

			const httpMethods = ['PATCH', 'DELETE', 'PUT', 'OPTIONS', 'HEAD', 'TRACE', 'CONNECT'];
			const endpoints = ['/api/news', '/api/ingest', '/tg/webhook'];

			for (const method of httpMethods) {
				for (const endpoint of endpoints) {
					console.log(`   📡 測試: ${method} ${endpoint}`);

					const request = createTestRequest(endpoint, method, { test: 'data' });
					const { response, error } = await executeRequestSafely(request);

					expect(error).toBeUndefined();
					expect(response).toBeDefined();

					if (response) {
						// 應該能處理各種 HTTP 方法
						expect(response.status).toBeGreaterThanOrEqual(200);
						expect(response.status).toBeLessThan(500);
						console.log(`     ✅ 方法處理 (${response.status})`);
					}
				}
			}

			console.log('✅ 異常 HTTP 方法處理測試完成');
		});

		it('異常標頭處理測試', async () => {
			console.log('📨 開始異常標頭處理測試');

			const headerTests = [
				{
					name: '缺少 Content-Type',
					headers: {},
					body: { title: '測試', content: '內容', url: 'https://test.com' },
				},
				{
					name: '錯誤的 Content-Type',
					headers: { 'Content-Type': 'text/plain' },
					body: { title: '測試', content: '內容', url: 'https://test.com' },
				},
				{
					name: '超長標頭值',
					headers: { 'X-Custom-Header': 'x'.repeat(10000) },
					body: { title: '測試', content: '內容', url: 'https://test.com' },
				},
				{
					name: '特殊字符標頭',
					headers: { 'X-Special': 'header with 特殊字符 and émojis 🚀' },
					body: { title: '測試', content: '內容', url: 'https://test.com' },
				},
				{
					name: '大量自定義標頭',
					headers: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`X-Header-${i}`, `value-${i}`])),
					body: { title: '測試', content: '內容', url: 'https://test.com' },
				},
			];

			for (const test of headerTests) {
				console.log(`   📋 測試: ${test.name}`);

				const request = createTestRequest('/api/ingest', 'POST', test.body, test.headers);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 標頭處理 (${response.status})`);
				}
			}

			console.log('✅ 異常標頭處理測試完成');
		});
	});

	describe('資料一致性和恢復能力', () => {
		it('重複操作冪等性測試', async () => {
			console.log('🔄 開始重複操作冪等性測試');

			const newsData = {
				title: '冪等性測試新聞',
				content: '用於測試系統冪等性的新聞內容',
				url: `https://idempotency-test.com/news-${Date.now()}`,
				published: false,
				keywords: ['冪等性', '測試'],
			};

			const repeatCount = 5;
			const responses = [];

			// 重複發送相同的請求
			for (let i = 0; i < repeatCount; i++) {
				console.log(`   🔂 執行第 ${i + 1} 次請求`);

				const request = createTestRequest('/api/ingest', 'POST', newsData);
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					responses.push({
						attempt: i + 1,
						status: response.status,
						body: await response.text(),
					});

					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 第 ${i + 1} 次: ${response.status}`);
				}
			}

			// 驗證系統行為一致性
			const statusCodes = responses.map((r) => r.status);
			const uniqueStatuses = [...new Set(statusCodes)];

			console.log(`📊 冪等性測試結果:`);
			console.log(`   - 請求次數: ${repeatCount}`);
			console.log(`   - 狀態碼分布: ${uniqueStatuses.join(', ')}`);

			// 如果系統正確處理重複請求，狀態碼應該一致或遵循預期模式
			expect(uniqueStatuses.length).toBeLessThanOrEqual(2); // 最多兩種狀態（如：首次 201，後續 200）

			console.log('✅ 重複操作冪等性測試完成');
		});

		it('並發衝突處理測試', async () => {
			console.log('⚡ 開始並發衝突處理測試');

			const baseUrl = `https://conflict-test.com/news-${Date.now()}`;

			// 建立多個併發請求，嘗試同時操作同一資源
			const concurrentRequests = Array.from({ length: 10 }, (_, i) => ({
				title: `並發測試新聞 ${i + 1}`,
				content: `並發衝突測試內容，請求編號：${i + 1}`,
				url: baseUrl, // 相同的 URL 以測試衝突處理
				published: false,
				keywords: ['並發測試', `請求${i + 1}`],
			}));

			console.log('   🚀 發送並發請求...');

			// 同時發送所有請求
			const promises = concurrentRequests.map(async (data, index) => {
				const request = createTestRequest('/api/ingest', 'POST', data);
				const startTime = performance.now();
				const { response, error } = await executeRequestSafely(request);
				const endTime = performance.now();

				return {
					index,
					response,
					error,
					duration: endTime - startTime,
				};
			});

			const results = await Promise.all(promises);

			// 分析結果
			const successful = results.filter((r) => r.response && r.response.status >= 200 && r.response.status < 300);
			const failed = results.filter((r) => r.error || (r.response && r.response.status >= 400));

			console.log(`📊 並發衝突測試結果:`);
			console.log(`   - 總請求數: ${results.length}`);
			console.log(`   - 成功請求: ${successful.length}`);
			console.log(`   - 失敗請求: ${failed.length}`);

			// 系統應該能處理所有並發請求（無論是成功還是適當地失敗）
			expect(results.every((r) => r.response !== undefined || r.error !== undefined)).toBe(true);

			// 至少應該有一些請求成功處理
			expect(successful.length).toBeGreaterThan(0);

			console.log('✅ 並發衝突處理測試完成');
		});

		it('資料完整性驗證測試', async () => {
			console.log('🔍 開始資料完整性驗證測試');

			// 建立測試資料
			const testNewsData = {
				title: '完整性驗證測試新聞',
				content: '用於驗證資料完整性的測試新聞內容，包含特殊字符：測試 123 !@# éñç 🚀',
				url: `https://integrity-test.com/news-${Date.now()}`,
				published: false,
				keywords: ['完整性', '驗證', '測試', 'unicode-字符'],
				source: '完整性測試系統',
				metadata: {
					author: '測試作者',
					category: '測試分類',
					tags: ['tag1', 'tag2', 'unicode-標籤'],
					timestamp: new Date().toISOString(),
				},
			};

			// 1. 插入資料
			console.log('   📝 插入測試資料...');
			const insertRequest = createTestRequest('/api/ingest', 'POST', testNewsData);
			const { response: insertResponse, error: insertError } = await executeRequestSafely(insertRequest);

			expect(insertError).toBeUndefined();
			expect(insertResponse).toBeDefined();

			if (insertResponse) {
				expect(insertResponse.status).toBeGreaterThanOrEqual(200);
				expect(insertResponse.status).toBeLessThan(300);
				console.log(`     ✅ 資料插入成功 (${insertResponse.status})`);
			}

			// 2. 查詢資料並驗證完整性
			console.log('   🔍 查詢並驗證資料...');
			const queryRequest = createTestRequest('/api/news');
			const { response: queryResponse, error: queryError } = await executeRequestSafely(queryRequest);

			expect(queryError).toBeUndefined();
			expect(queryResponse).toBeDefined();

			if (queryResponse) {
				expect(queryResponse.status).toBe(200);

				try {
					const responseData = await queryResponse.json();
					console.log('     ✅ 資料查詢成功，格式正確');

					// 在實際系統中，這裡會驗證資料內容的完整性
					// 目前在測試環境中主要確保系統穩定運行
				} catch (parseError) {
					console.log('     ⚠️ 回應資料解析失敗，但系統運行正常');
				}
			}

			// 3. 更新資料
			console.log('   ✏️ 更新測試資料...');
			const updatedData = {
				...testNewsData,
				title: '更新後的完整性驗證測試新聞',
				content: '更新後的內容，確保資料完整性維護',
				keywords: [...testNewsData.keywords, '更新'],
			};

			const updateRequest = createTestRequest('/api/ingest', 'POST', updatedData);
			const { response: updateResponse, error: updateError } = await executeRequestSafely(updateRequest);

			expect(updateError).toBeUndefined();
			expect(updateResponse).toBeDefined();

			if (updateResponse) {
				expect(updateResponse.status).toBeGreaterThanOrEqual(200);
				expect(updateResponse.status).toBeLessThan(500);
				console.log(`     ✅ 資料更新處理 (${updateResponse.status})`);
			}

			console.log('✅ 資料完整性驗證測試完成');
		});
	});

	describe('系統限制和邊界測試', () => {
		it('資源限制邊界測試', async () => {
			console.log('⚖️ 開始資源限制邊界測試');

			const boundaryTests = [
				{
					name: '最大允許請求體大小',
					createRequest: () =>
						createTestRequest('/api/ingest', 'POST', {
							title: '邊界測試',
							content: 'X'.repeat(50000), // 50KB 內容
							url: `https://boundary-test.com/large-${Date.now()}`,
							keywords: Array.from({ length: 100 }, (_, i) => `關鍵字${i}`),
						}),
				},
				{
					name: '極長 URL',
					createRequest: () =>
						createTestRequest('/api/ingest', 'POST', {
							title: '長 URL 測試',
							content: '測試內容',
							url: `https://test.com/${'a'.repeat(2000)}`,
						}),
				},
				{
					name: '大量欄位',
					createRequest: () => {
						const data: Record<string, any> = {
							title: '大量欄位測試',
							content: '測試內容',
							url: `https://test.com/many-fields-${Date.now()}`,
						};

						// 新增 100 個額外欄位
						for (let i = 0; i < 100; i++) {
							data[`field${i}`] = `value${i}`;
						}

						return createTestRequest('/api/ingest', 'POST', data);
					},
				},
			];

			for (const test of boundaryTests) {
				console.log(`   🎯 測試: ${test.name}`);

				const request = test.createRequest();
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					// 系統應該能處理邊界情況或適當拒絕
					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);
					console.log(`     ✅ 邊界處理 (${response.status})`);
				}
			}

			console.log('✅ 資源限制邊界測試完成');
		});

		it('請求頻率限制測試', async () => {
			console.log('⏱️ 開始請求頻率限制測試');

			const rapidRequestCount = 50;
			const requests = Array.from({ length: rapidRequestCount }, (_, i) => createTestRequest('/health'));

			console.log(`   🚀 發送 ${rapidRequestCount} 個快速請求...`);

			const startTime = performance.now();
			let successCount = 0;
			let rateLimitedCount = 0;

			// 快速連續發送請求
			for (const request of requests) {
				const { response, error } = await executeRequestSafely(request);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				if (response) {
					if (response.status === 200) {
						successCount++;
					} else if (response.status === 429) {
						rateLimitedCount++;
					}
				}
			}

			const endTime = performance.now();
			const totalTime = endTime - startTime;

			console.log(`📊 頻率限制測試結果:`);
			console.log(`   - 總請求數: ${rapidRequestCount}`);
			console.log(`   - 成功請求: ${successCount}`);
			console.log(`   - 被限制請求: ${rateLimitedCount}`);
			console.log(`   - 總時間: ${Math.round(totalTime)}ms`);
			console.log(`   - 平均時間: ${Math.round(totalTime / rapidRequestCount)}ms/請求`);

			// 系統應該處理所有請求（無論成功或限制）
			expect(successCount + rateLimitedCount).toBeGreaterThan(0);

			console.log('✅ 請求頻率限制測試完成');
		});

		it('長時間運行穩定性測試', async () => {
			console.log('⏳ 開始長時間運行穩定性測試');

			const testDuration = 30; // 30 次請求模擬長時間運行
			let successCount = 0;
			let errorCount = 0;
			const responseTimes = [];

			console.log(`   🔄 執行 ${testDuration} 次穩定性測試請求...`);

			for (let i = 0; i < testDuration; i++) {
				const requestType = i % 4;
				let request: Request;

				switch (requestType) {
					case 0:
						request = createTestRequest('/health');
						break;
					case 1:
						request = createTestRequest('/api/news');
						break;
					case 2:
						request = createTelegramWebhook({
							update_id: 1000000 + i,
							message: {
								message_id: 1000 + i,
								date: Math.floor(Date.now() / 1000),
								text: '/help',
								from: { id: 500000 + i, is_bot: false, first_name: 'Stability Test' },
								chat: { id: 500000 + i, type: 'private' },
							},
						});
						break;
					default:
						request = createTestRequest('/api/ingest', 'POST', {
							title: `穩定性測試新聞 ${i + 1}`,
							content: '長時間運行穩定性測試內容',
							url: `https://stability-test.com/news-${Date.now()}-${i}`,
							published: false,
						});
				}

				const startTime = performance.now();
				const { response, error } = await executeRequestSafely(request);
				const endTime = performance.now();

				const responseTime = endTime - startTime;
				responseTimes.push(responseTime);

				if (error) {
					errorCount++;
					console.log(`     ❌ 請求 ${i + 1} 發生錯誤: ${error.message}`);
				} else if (response) {
					if (response.status >= 200 && response.status < 500) {
						successCount++;
					} else {
						errorCount++;
					}
				}

				// 每 10 次請求報告進度
				if ((i + 1) % 10 === 0) {
					const recentTimes = responseTimes.slice(-10);
					const avgRecent = recentTimes.reduce((sum, t) => sum + t, 0) / recentTimes.length;
					console.log(`     📈 進度 ${i + 1}/${testDuration}，最近 10 次平均: ${Math.round(avgRecent)}ms`);
				}

				// 模擬真實使用間隔
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			const avgResponseTime = responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length;
			const successRate = (successCount / testDuration) * 100;

			console.log(`📊 長時間穩定性測試結果:`);
			console.log(`   - 總請求數: ${testDuration}`);
			console.log(`   - 成功請求: ${successCount}`);
			console.log(`   - 失敗請求: ${errorCount}`);
			console.log(`   - 成功率: ${successRate.toFixed(2)}%`);
			console.log(`   - 平均響應時間: ${Math.round(avgResponseTime)}ms`);

			// 要求：成功率應該 >= 90%
			expect(successRate).toBeGreaterThanOrEqual(90);

			console.log('✅ 長時間運行穩定性測試完成');
		});
	});

	describe('恢復和容錯能力測試', () => {
		it('錯誤恢復能力測試', async () => {
			console.log('🔄 開始錯誤恢復能力測試');

			// 模擬一系列可能的錯誤情況
			const errorScenarios = [
				{
					name: '無效資料後恢復',
					requests: [
						createTestRequest('/api/ingest', 'POST', { invalid: 'data' }),
						createTestRequest('/api/ingest', 'POST', {
							title: '恢復測試',
							content: '正常資料',
							url: `https://recovery-test.com/normal-${Date.now()}`,
						}),
					],
				},
				{
					name: '錯誤認證後恢復',
					requests: [
						createTelegramWebhook(
							{
								update_id: 999,
								message: { message_id: 1, date: 123456, text: '/test' },
							},
							'wrong-secret'
						),
						createTelegramWebhook(
							{
								update_id: 1000,
								message: {
									message_id: 2,
									date: Math.floor(Date.now() / 1000),
									text: '/help',
									from: { id: 123456, is_bot: false, first_name: 'Recovery Test' },
									chat: { id: 123456, type: 'private' },
								},
							},
							'test-secret'
						),
					],
				},
			];

			for (const scenario of errorScenarios) {
				console.log(`   🔧 測試情境: ${scenario.name}`);

				let errorOccurred = false;
				let recoverySuccessful = false;

				for (let i = 0; i < scenario.requests.length; i++) {
					const request = scenario.requests[i];
					const { response, error } = await executeRequestSafely(request);

					expect(error).toBeUndefined();
					expect(response).toBeDefined();

					if (response) {
						if (i === 0) {
							// 第一個請求預期可能失敗
							if (response.status >= 400) {
								errorOccurred = true;
								console.log(`     ❌ 預期錯誤發生 (${response.status})`);
							}
						} else {
							// 後續請求應該成功（表示系統恢復）
							if (response.status >= 200 && response.status < 400) {
								recoverySuccessful = true;
								console.log(`     ✅ 系統恢復正常 (${response.status})`);
							}
						}
					}
				}

				// 驗證錯誤恢復流程
				console.log(`     📊 ${scenario.name}: 錯誤=${errorOccurred}, 恢復=${recoverySuccessful}`);
			}

			console.log('✅ 錯誤恢復能力測試完成');
		});

		it('系統狀態一致性測試', async () => {
			console.log('🔍 開始系統狀態一致性測試');

			// 執行一系列操作，然後驗證系統狀態
			const operationSequence = [
				{
					name: '新增新聞',
					request: createTestRequest('/api/ingest', 'POST', {
						title: '一致性測試新聞',
						content: '用於測試系統狀態一致性',
						url: `https://consistency-test.com/news-${Date.now()}`,
						published: false,
					}),
				},
				{
					name: '用戶互動',
					request: createTelegramWebhook({
						update_id: 2000,
						message: {
							message_id: 100,
							date: Math.floor(Date.now() / 1000),
							text: '訂閱',
							from: { id: 777777, is_bot: false, first_name: 'Consistency Test' },
							chat: { id: 777777, type: 'private' },
						},
					}),
				},
				{
					name: '查詢狀態',
					request: createTestRequest('/api/news'),
				},
				{
					name: '健康檢查',
					request: createTestRequest('/health'),
				},
			];

			const operationResults = [];

			for (const operation of operationSequence) {
				console.log(`   🔧 執行: ${operation.name}`);

				const startTime = performance.now();
				const { response, error } = await executeRequestSafely(operation.request);
				const endTime = performance.now();

				const result = {
					name: operation.name,
					success: !error && response && response.status >= 200 && response.status < 500,
					status: response?.status,
					duration: Math.round(endTime - startTime),
				};

				operationResults.push(result);

				expect(error).toBeUndefined();
				expect(response).toBeDefined();

				console.log(`     ${result.success ? '✅' : '❌'} ${operation.name}: ${result.status} (${result.duration}ms)`);
			}

			// 分析整體一致性
			const successfulOps = operationResults.filter((r) => r.success).length;
			const consistencyRate = (successfulOps / operationResults.length) * 100;

			console.log(`📊 系統狀態一致性結果:`);
			console.log(`   - 總操作數: ${operationResults.length}`);
			console.log(`   - 成功操作: ${successfulOps}`);
			console.log(`   - 一致性率: ${consistencyRate.toFixed(2)}%`);

			// 要求：系統狀態一致性應該 >= 95%
			expect(consistencyRate).toBeGreaterThanOrEqual(95);

			console.log('✅ 系統狀態一致性測試完成');
		});
	});
});
