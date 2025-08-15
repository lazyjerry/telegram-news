import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 17.2 效能測試
 * 測試系統在各種負載條件下的效能表現
 */
describe('效能測試', () => {
	const performanceThresholds = {
		singleRequest: 1000, // 單一請求應在 1 秒內完成
		batchRequests: 5000, // 批量請求應在 5 秒內完成
		highConcurrency: 10000, // 高併發請求應在 10 秒內完成
		memoryLimit: 100, // 記憶體使用限制 (MB - 在測試環境中難以精確測量)
	};

	// 輔助函數：建立效能測試請求
	const createPerformanceRequest = (path: string, method: string = 'GET', body?: any) => {
		return new Request(`http://example.com${path}`, {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		});
	};

	// 輔助函數：建立 Telegram webhook 請求
	const createTelegramRequest = (text: string, chatId: number = Math.floor(Math.random() * 1000000)) => {
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
					text,
					from: { id: chatId, is_bot: false, first_name: 'Perf Test' },
					chat: { id: chatId, type: 'private' },
				},
			}),
		});
	};

	// 輔助函數：測量請求執行時間
	const measureRequestTime = async (request: Request): Promise<{ response: Response; duration: number }> => {
		const startTime = performance.now();

		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		const endTime = performance.now();
		return { response, duration: endTime - startTime };
	};

	describe('單一請求效能測試', () => {
		it('API 端點響應時間測試', async () => {
			console.log('⚡ 開始 API 端點響應時間測試');

			const apiEndpoints = [
				{ path: '/', name: '首頁' },
				{ path: '/health', name: '健康檢查' },
				{ path: '/api/news', name: '新聞列表' },
				{ path: '/api/subscriptions', name: '訂閱列表' },
			];

			const results = [];

			for (const endpoint of apiEndpoints) {
				const request = createPerformanceRequest(endpoint.path);
				const { response, duration } = await measureRequestTime(request);

				expect(response.status).toBeGreaterThanOrEqual(200);
				expect(response.status).toBeLessThan(500);
				expect(duration).toBeLessThan(performanceThresholds.singleRequest);

				results.push({ endpoint: endpoint.name, duration: Math.round(duration) });
				console.log(`📊 ${endpoint.name}: ${Math.round(duration)}ms`);
			}

			const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
			console.log(`📈 API 端點平均響應時間: ${Math.round(avgDuration)}ms`);
			console.log('✅ API 端點響應時間測試完成');
		});

		it('Telegram Webhook 處理時間測試', async () => {
			console.log('📱 開始 Telegram Webhook 處理時間測試');

			const telegramCommands = ['/start', '/help', '訂閱', '狀態', '幫助'];

			const results = [];

			for (const command of telegramCommands) {
				const request = createTelegramRequest(command);
				const { response, duration } = await measureRequestTime(request);

				expect(response.status).toBe(200);
				expect(duration).toBeLessThan(performanceThresholds.singleRequest);

				results.push({ command, duration: Math.round(duration) });
				console.log(`📊 ${command}: ${Math.round(duration)}ms`);
			}

			const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
			console.log(`📈 Telegram 指令平均處理時間: ${Math.round(avgDuration)}ms`);
			console.log('✅ Telegram Webhook 處理時間測試完成');
		});

		it('新聞匯入效能測試', async () => {
			console.log('📰 開始新聞匯入效能測試');

			const newsSizes = [
				{
					name: '小型新聞',
					data: {
						title: '效能測試 - 小型',
						content: '短新聞內容',
						url: `https://perf-test.com/small-${Date.now()}`,
						keywords: ['測試'],
					},
				},
				{
					name: '中型新聞',
					data: {
						title: '效能測試 - 中型',
						content: '中等長度的新聞內容，包含更多詳細資訊和描述。'.repeat(10),
						url: `https://perf-test.com/medium-${Date.now()}`,
						keywords: ['測試', '效能', '中型'],
					},
				},
				{
					name: '大型新聞',
					data: {
						title: '效能測試 - 大型',
						content: '非常詳細的新聞內容，包含大量文字和資訊，用於測試系統處理大型資料的效能。'.repeat(50),
						url: `https://perf-test.com/large-${Date.now()}`,
						keywords: Array.from({ length: 20 }, (_, i) => `關鍵字${i + 1}`),
					},
				},
			];

			const results = [];

			for (const newsSize of newsSizes) {
				const request = createPerformanceRequest('/api/ingest', 'POST', newsSize.data);
				const { response, duration } = await measureRequestTime(request);

				expect(response.status).toBe(200);
				expect(duration).toBeLessThan(performanceThresholds.singleRequest);

				results.push({ size: newsSize.name, duration: Math.round(duration) });
				console.log(`📊 ${newsSize.name}: ${Math.round(duration)}ms`);
			}

			const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
			console.log(`📈 新聞匯入平均時間: ${Math.round(avgDuration)}ms`);
			console.log('✅ 新聞匯入效能測試完成');
		});
	});

	describe('批量請求效能測試', () => {
		it('批量新聞匯入測試', async () => {
			console.log('📚 開始批量新聞匯入測試');

			const batchSize = 20;
			const newsItems = Array.from({ length: batchSize }, (_, i) => ({
				title: `批量測試新聞 ${i + 1}`,
				content: `批量測試新聞內容 ${i + 1}，用於測試系統批量處理能力。`,
				url: `https://batch-test.com/news-${Date.now()}-${i}`,
				published: false,
				keywords: ['批量測試', `批次${Math.floor(i / 5) + 1}`],
				source: '效能測試',
			}));

			const startTime = performance.now();
			let successCount = 0;

			for (const newsItem of newsItems) {
				const request = createPerformanceRequest('/api/ingest', 'POST', newsItem);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status === 200) {
					successCount++;
				}
			}

			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			expect(successCount).toBe(batchSize);
			expect(totalDuration).toBeLessThan(performanceThresholds.batchRequests);

			const avgDuration = totalDuration / batchSize;
			console.log(`📊 批量匯入統計:`);
			console.log(`   - 總新聞數: ${batchSize}`);
			console.log(`   - 成功匯入: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均時間: ${Math.round(avgDuration)}ms/項`);
			console.log('✅ 批量新聞匯入測試完成');
		});

		it('批量用戶互動測試', async () => {
			console.log('👥 開始批量用戶互動測試');

			const userCount = 25;
			const commands = ['/start', '/help', '訂閱', '狀態', '幫助'];

			const requests = Array.from({ length: userCount }, (_, i) => {
				const userId = 888000 + i;
				const command = commands[i % commands.length];
				return createTelegramRequest(command, userId);
			});

			const startTime = performance.now();
			let successCount = 0;

			for (const request of requests) {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status === 200) {
					successCount++;
				}
			}

			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			expect(successCount).toBe(userCount);
			expect(totalDuration).toBeLessThan(performanceThresholds.batchRequests);

			const avgDuration = totalDuration / userCount;
			console.log(`📊 批量互動統計:`);
			console.log(`   - 總用戶數: ${userCount}`);
			console.log(`   - 成功處理: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均時間: ${Math.round(avgDuration)}ms/用戶`);
			console.log('✅ 批量用戶互動測試完成');
		});

		it('混合負載批量測試', async () => {
			console.log('🔄 開始混合負載批量測試');

			const mixedRequests = [
				// API 請求
				...Array.from({ length: 5 }, () => createPerformanceRequest('/api/news')),
				...Array.from({ length: 5 }, () => createPerformanceRequest('/health')),

				// 新聞匯入請求
				...Array.from({ length: 8 }, (_, i) =>
					createPerformanceRequest('/api/ingest', 'POST', {
						title: `混合測試新聞 ${i + 1}`,
						content: `混合負載測試內容 ${i + 1}`,
						url: `https://mixed-test.com/news-${Date.now()}-${i}`,
						published: false,
					})
				),

				// Telegram 請求
				...Array.from({ length: 12 }, (_, i) => {
					const commands = ['/start', '/help', '訂閱', '狀態'];
					return createTelegramRequest(commands[i % commands.length], 999000 + i);
				}),
			];

			// 隨機化請求順序以模擬真實情況
			const shuffledRequests = mixedRequests.sort(() => Math.random() - 0.5);

			const startTime = performance.now();
			let successCount = 0;

			for (const request of shuffledRequests) {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status >= 200 && response.status < 500) {
					successCount++;
				}
			}

			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			expect(successCount).toBe(shuffledRequests.length);
			expect(totalDuration).toBeLessThan(performanceThresholds.batchRequests);

			const avgDuration = totalDuration / shuffledRequests.length;
			console.log(`📊 混合負載統計:`);
			console.log(`   - 總請求數: ${shuffledRequests.length}`);
			console.log(`   - 成功處理: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均時間: ${Math.round(avgDuration)}ms/請求`);
			console.log('✅ 混合負載批量測試完成');
		});
	});

	describe('併發請求效能測試', () => {
		it('高併發 API 請求測試', async () => {
			console.log('⚡ 開始高併發 API 請求測試');

			const concurrencyLevel = 20;
			const requests = Array.from({ length: concurrencyLevel }, (_, i) => {
				const endpoints = ['/api/news', '/health', '/api/subscriptions'];
				const endpoint = endpoints[i % endpoints.length];
				return createPerformanceRequest(endpoint);
			});

			const startTime = performance.now();

			// 併發執行所有請求
			const promises = requests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);
			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			// 驗證所有請求都成功
			const successCount = responses.filter((r) => r.status >= 200 && r.status < 500).length;

			expect(successCount).toBe(concurrencyLevel);
			expect(totalDuration).toBeLessThan(performanceThresholds.highConcurrency);

			console.log(`📊 高併發 API 統計:`);
			console.log(`   - 併發級別: ${concurrencyLevel}`);
			console.log(`   - 成功請求: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均並行時間: ${Math.round(totalDuration / concurrencyLevel)}ms`);
			console.log('✅ 高併發 API 請求測試完成');
		});

		it('併發 Telegram 處理測試', async () => {
			console.log('📱 開始併發 Telegram 處理測試');

			const concurrencyLevel = 15;
			const commands = ['/start', '/help', '訂閱', '狀態', '幫助'];

			const requests = Array.from({ length: concurrencyLevel }, (_, i) => {
				const userId = 777000 + i;
				const command = commands[i % commands.length];
				return createTelegramRequest(command, userId);
			});

			const startTime = performance.now();

			// 併發執行所有 Telegram 請求
			const promises = requests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);
			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			// 驗證所有 Telegram 請求都成功
			const successCount = responses.filter((r) => r.status === 200).length;

			expect(successCount).toBe(concurrencyLevel);
			expect(totalDuration).toBeLessThan(performanceThresholds.highConcurrency);

			console.log(`📊 併發 Telegram 統計:`);
			console.log(`   - 併發級別: ${concurrencyLevel}`);
			console.log(`   - 成功處理: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均並行時間: ${Math.round(totalDuration / concurrencyLevel)}ms`);
			console.log('✅ 併發 Telegram 處理測試完成');
		});

		it('混合併發負載測試', async () => {
			console.log('🌪️ 開始混合併發負載測試');

			const apiRequests = Array.from({ length: 8 }, () => createPerformanceRequest('/api/news'));

			const ingestRequests = Array.from({ length: 6 }, (_, i) =>
				createPerformanceRequest('/api/ingest', 'POST', {
					title: `併發測試新聞 ${i + 1}`,
					content: `併發負載測試內容 ${i + 1}`,
					url: `https://concurrent-test.com/news-${Date.now()}-${i}`,
					published: false,
				})
			);

			const telegramRequests = Array.from({ length: 10 }, (_, i) => {
				const commands = ['/start', '/help', '訂閱', '狀態'];
				return createTelegramRequest(commands[i % commands.length], 666000 + i);
			});

			const allRequests = [...apiRequests, ...ingestRequests, ...telegramRequests];
			const totalRequests = allRequests.length;

			const startTime = performance.now();

			// 併發執行所有不同類型的請求
			const promises = allRequests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);
			const endTime = performance.now();
			const totalDuration = endTime - startTime;

			// 分析結果
			const successCount = responses.filter((r) => r.status >= 200 && r.status < 500).length;

			expect(successCount).toBe(totalRequests);
			expect(totalDuration).toBeLessThan(performanceThresholds.highConcurrency);

			console.log(`📊 混合併發負載統計:`);
			console.log(`   - API 請求: ${apiRequests.length}`);
			console.log(`   - 匯入請求: ${ingestRequests.length}`);
			console.log(`   - Telegram 請求: ${telegramRequests.length}`);
			console.log(`   - 總請求數: ${totalRequests}`);
			console.log(`   - 成功處理: ${successCount}`);
			console.log(`   - 總時間: ${Math.round(totalDuration)}ms`);
			console.log(`   - 平均並行時間: ${Math.round(totalDuration / totalRequests)}ms`);
			console.log('✅ 混合併發負載測試完成');
		});
	});

	describe('資源使用效能測試', () => {
		it('大型資料處理效能測試', async () => {
			console.log('📊 開始大型資料處理效能測試');

			// 建立大型新聞資料
			const largeNewsData = {
				title: '大型資料效能測試新聞',
				content: '這是一則包含大量內容的新聞，用於測試系統處理大型資料的效能表現。'.repeat(200),
				url: `https://large-data-test.com/news-${Date.now()}`,
				published: false,
				keywords: Array.from({ length: 50 }, (_, i) => `大型資料關鍵字${i + 1}`),
				source: '大型資料測試系統',
				metadata: {
					description: '詳細描述資訊'.repeat(100),
					tags: Array.from({ length: 30 }, (_, i) => `標籤${i + 1}`),
					categories: ['測試', '效能', '大型資料', '系統驗證'],
					author: '效能測試作者',
					publishDate: new Date().toISOString(),
					lastModified: new Date().toISOString(),
				},
			};

			const request = createPerformanceRequest('/api/ingest', 'POST', largeNewsData);
			const { response, duration } = await measureRequestTime(request);

			expect(response.status).toBe(200);
			expect(duration).toBeLessThan(performanceThresholds.singleRequest * 2); // 大型資料允許更長時間

			console.log(`📊 大型資料處理結果:`);
			console.log(`   - 內容大小: ~${JSON.stringify(largeNewsData).length} 字符`);
			console.log(`   - 處理時間: ${Math.round(duration)}ms`);
			console.log(`   - 關鍵字數: ${largeNewsData.keywords.length}`);
			console.log('✅ 大型資料處理效能測試完成');
		});

		it('連續請求記憶體穩定性測試', async () => {
			console.log('🔄 開始連續請求記憶體穩定性測試');

			const requestCount = 100;
			const durations = [];
			let successCount = 0;

			for (let i = 0; i < requestCount; i++) {
				const request = createPerformanceRequest('/health');
				const { response, duration } = await measureRequestTime(request);

				if (response.status === 200) {
					successCount++;
					durations.push(duration);
				}

				// 每 20 次請求報告進度
				if ((i + 1) % 20 === 0) {
					const avgDuration = durations.slice(-20).reduce((sum, d) => sum + d, 0) / 20;
					console.log(`   - 完成 ${i + 1}/${requestCount}，最近 20 次平均: ${Math.round(avgDuration)}ms`);
				}
			}

			// 分析效能趨勢
			const firstQuarter = durations.slice(0, Math.floor(requestCount / 4));
			const lastQuarter = durations.slice(-Math.floor(requestCount / 4));

			const firstAvg = firstQuarter.reduce((sum, d) => sum + d, 0) / firstQuarter.length;
			const lastAvg = lastQuarter.reduce((sum, d) => sum + d, 0) / lastQuarter.length;
			const overallAvg = durations.reduce((sum, d) => sum + d, 0) / durations.length;

			expect(successCount).toBe(requestCount);

			// 檢查效能沒有明顯降低（記憶體洩漏的跡象）
			const performanceDegradation = (lastAvg - firstAvg) / firstAvg;
			expect(performanceDegradation).toBeLessThan(0.5); // 效能降低不應超過 50%

			console.log(`📊 記憶體穩定性統計:`);
			console.log(`   - 總請求數: ${requestCount}`);
			console.log(`   - 成功請求: ${successCount}`);
			console.log(`   - 整體平均時間: ${Math.round(overallAvg)}ms`);
			console.log(`   - 前四分之一平均: ${Math.round(firstAvg)}ms`);
			console.log(`   - 後四分之一平均: ${Math.round(lastAvg)}ms`);
			console.log(`   - 效能變化: ${(performanceDegradation * 100).toFixed(2)}%`);
			console.log('✅ 連續請求記憶體穩定性測試完成');
		});

		it('複雜操作效能基準測試', async () => {
			console.log('🎯 開始複雜操作效能基準測試');

			const complexOperations = [
				{
					name: '複雜新聞匯入',
					operation: async () => {
						const complexNews = {
							title: '複雜操作測試新聞 - 包含多層次資料結構',
							content: ['這是一則複雜的測試新聞，', '包含多種資料類型和結構，', '用於驗證系統的複雜處理能力。'].join(' ').repeat(20),
							url: `https://complex-test.com/news-${Date.now()}`,
							published: false,
							keywords: Array.from({ length: 25 }, (_, i) => `複雜關鍵字${i + 1}`),
							source: '複雜操作測試',
							metadata: {
								complexity: 'high',
								testType: 'performance',
								nestedData: {
									level1: { level2: { level3: '深層巢狀資料' } },
									arrays: [1, 2, 3, 4, 5],
									objects: Array.from({ length: 10 }, (_, i) => ({ id: i, value: `值${i}` })),
								},
							},
						};

						return createPerformanceRequest('/api/ingest', 'POST', complexNews);
					},
				},
				{
					name: '複合 API 查詢',
					operation: async () => {
						return createPerformanceRequest('/api/news?limit=100&detailed=true');
					},
				},
				{
					name: '複雜 Telegram 互動',
					operation: async () => {
						return createTelegramRequest('訂閱 關鍵字 測試 複雜 操作', 555000);
					},
				},
			];

			const results = [];

			for (const op of complexOperations) {
				console.log(`   🔧 執行 ${op.name}...`);

				const request = await op.operation();
				const { response, duration } = await measureRequestTime(request);

				expect(response.status).toBeGreaterThanOrEqual(200);
				expect(response.status).toBeLessThan(500);
				expect(duration).toBeLessThan(performanceThresholds.singleRequest * 3); // 複雜操作允許更長時間

				results.push({ name: op.name, duration: Math.round(duration) });
				console.log(`     ⏱️  ${op.name}: ${Math.round(duration)}ms`);
			}

			const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
			console.log(`📊 複雜操作基準統計:`);
			console.log(`   - 操作數量: ${results.length}`);
			console.log(`   - 總時間: ${totalDuration}ms`);
			console.log(`   - 平均時間: ${Math.round(totalDuration / results.length)}ms`);
			console.log('✅ 複雜操作效能基準測試完成');
		});
	});

	describe('效能回歸測試', () => {
		it('效能基準對比測試', async () => {
			console.log('📈 開始效能基準對比測試');

			// 建立基準測試套件
			const benchmarkTests = [
				{ name: '簡單 API', request: () => createPerformanceRequest('/health'), baseline: 100 },
				{ name: '新聞查詢', request: () => createPerformanceRequest('/api/news'), baseline: 200 },
				{ name: 'Telegram 指令', request: () => createTelegramRequest('/help'), baseline: 150 },
				{
					name: '新聞匯入',
					request: () =>
						createPerformanceRequest('/api/ingest', 'POST', {
							title: '基準測試新聞',
							content: '基準測試內容',
							url: `https://benchmark-test.com/news-${Date.now()}`,
							published: false,
						}),
					baseline: 300,
				},
			];

			const results = [];

			for (const test of benchmarkTests) {
				// 執行多次測試取平均值
				const runs = 5;
				const durations = [];

				for (let i = 0; i < runs; i++) {
					const request = test.request();
					const { response, duration } = await measureRequestTime(request);

					expect(response.status).toBeGreaterThanOrEqual(200);
					expect(response.status).toBeLessThan(500);

					durations.push(duration);
				}

				const avgDuration = durations.reduce((sum, d) => sum + d, 0) / runs;
				const performanceRatio = avgDuration / test.baseline;

				results.push({
					name: test.name,
					average: Math.round(avgDuration),
					baseline: test.baseline,
					ratio: performanceRatio.toFixed(2),
				});

				// 效能不應該比基準差太多
				expect(performanceRatio).toBeLessThan(3.0); // 不超過基準的 3 倍

				console.log(`📊 ${test.name}:`);
				console.log(`   - 平均時間: ${Math.round(avgDuration)}ms`);
				console.log(`   - 基準時間: ${test.baseline}ms`);
				console.log(`   - 效能比率: ${performanceRatio.toFixed(2)}x`);
			}

			console.log('✅ 效能基準對比測試完成');
		});
	});
});
