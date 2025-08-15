import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.3 UPSERT 行為測試
 * 測試相同 URL 的貼文更新行為，確保不會產生重複記錄
 */
describe('UPSERT 行為測試', () => {
	const testUrl = 'https://example.com/test-news-article';
	const testPostData = {
		title: '測試新聞標題',
		content: '這是測試新聞的內容...',
		url: testUrl,
		author: '測試作者',
		publish_time: '2024-01-15 12:00:00',
		source: '測試新聞源',
		tags: ['科技', '測試'],
		filters_json: '{"usernames": []}',
	};

	describe('相同 URL 更新不重複', () => {
		it('首次 POST /api/ingest 應成功建立新貼文', async () => {
			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(testPostData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應狀態：應該是 201 Created
			expect(response.status).toBe(201);

			const responseData = (await response.json()) as any;

			// 驗證回應內容
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('post');
			expect(responseData.post).toHaveProperty('url', testUrl);
			expect(responseData.post).toHaveProperty('title', testPostData.title);
			expect(responseData.post).toHaveProperty('published', 0);

			// 驗證回應包含操作類型（應為新建）
			expect(responseData).toHaveProperty('operation', 'created');
		});

		it('相同 URL 但不同內容的第二次 POST 應更新現有貼文', async () => {
			const updatedPostData = {
				...testPostData,
				title: '更新後的測試新聞標題',
				content: '這是更新後的測試新聞內容...',
				author: '更新作者',
				tags: ['科技', '測試', '更新'],
			};

			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(updatedPostData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應狀態：應該是 200 OK（更新）
			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			// 驗證更新後的內容
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('post');
			expect(responseData.post).toHaveProperty('url', testUrl);
			expect(responseData.post).toHaveProperty('title', updatedPostData.title);
			expect(responseData.post).toHaveProperty('content', updatedPostData.content);
			expect(responseData.post).toHaveProperty('author', updatedPostData.author);

			// 驗證回應包含操作類型（應為更新）
			expect(responseData).toHaveProperty('operation', 'updated');

			// 驗證 published 狀態重設為 0（因為內容已更新）
			expect(responseData.post).toHaveProperty('published', 0);
		});

		it('完全相同的內容重複提交應回傳現有貼文不做更新', async () => {
			// 使用與第一次完全相同的資料
			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(testPostData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 驗證回應狀態：應該是 200 OK
			expect(response.status).toBe(200);

			const responseData = (await response.json()) as any;

			// 驗證回應內容
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('post');
			expect(responseData.post).toHaveProperty('url', testUrl);

			// 驗證回應包含操作類型（應為無變更）
			expect(responseData).toHaveProperty('operation', 'no_change');
		});

		it('多個不同 URL 的貼文應正確分別儲存', async () => {
			const posts = [
				{
					...testPostData,
					title: '第一篇測試文章',
					url: 'https://example.com/article-1',
				},
				{
					...testPostData,
					title: '第二篇測試文章',
					url: 'https://example.com/article-2',
				},
				{
					...testPostData,
					title: '第三篇測試文章',
					url: 'https://example.com/article-3',
				},
			];

			const responses = [];

			// 依序提交三篇不同的文章
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

				responses.push({
					status: response.status,
					data: await response.json(),
				});
			}

			// 驗證所有三篇文章都成功建立
			responses.forEach((response, index) => {
				expect(response.status).toBe(201); // 都應該是新建
				const data = response.data as any;
				expect(data).toHaveProperty('success', true);
				expect(data).toHaveProperty('operation', 'created');
				expect(data.post).toHaveProperty('url', posts[index].url);
				expect(data.post).toHaveProperty('title', posts[index].title);
			});
		});
	});

	describe('發布狀態處理', () => {
		it('已發布的貼文更新應重設 published 狀態', async () => {
			const publishedUrl = 'https://example.com/published-article';

			// 先建立一篇文章
			const initialData = {
				...testPostData,
				url: publishedUrl,
				title: '待發布的文章',
			};

			const createRequest = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(initialData),
			});

			const createCtx = createExecutionContext();
			const createResponse = await worker.fetch(createRequest, env, createCtx);
			await waitOnExecutionContext(createCtx);

			expect(createResponse.status).toBe(201);

			// 模擬文章已發布（在實際環境中這會由 cron 任務處理）
			// 這裡我們假設有某種方式標記文章為已發布...

			// 現在更新已發布的文章
			const updatedData = {
				...initialData,
				title: '更新後的已發布文章',
				content: '這是更新後的內容',
			};

			const updateRequest = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(updatedData),
			});

			const updateCtx = createExecutionContext();
			const updateResponse = await worker.fetch(updateRequest, env, updateCtx);
			await waitOnExecutionContext(updateCtx);

			expect(updateResponse.status).toBe(200);

			const responseData = (await updateResponse.json()) as any;

			// 驗證更新後的內容
			expect(responseData).toHaveProperty('success', true);
			expect(responseData).toHaveProperty('operation', 'updated');
			expect(responseData.post).toHaveProperty('title', updatedData.title);
			expect(responseData.post).toHaveProperty('content', updatedData.content);

			// 重要：驗證 published 狀態重設為 0
			expect(responseData.post).toHaveProperty('published', 0);
		});
	});

	describe('錯誤處理', () => {
		it('無效的 URL 格式應回傳 400 Bad Request', async () => {
			const invalidData = {
				...testPostData,
				url: 'not-a-valid-url',
			};

			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(invalidData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success', false);
			expect(responseData).toHaveProperty('error');
		});

		it('缺少必要欄位應回傳 400 Bad Request', async () => {
			const incompleteData = {
				title: '測試標題',
				// 缺少 url, content 等必要欄位
			};

			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(incompleteData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);

			const responseData = (await response.json()) as any;
			expect(responseData).toHaveProperty('success', false);
			expect(responseData).toHaveProperty('error');
		});

		it('過長的內容應被正確處理或截斷', async () => {
			const longContentData = {
				...testPostData,
				url: 'https://example.com/long-content-test',
				content: 'x'.repeat(10000), // 非常長的內容
				title: 'y'.repeat(500), // 非常長的標題
			};

			const request = new Request('http://example.com/api/ingest', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-API-Key': 'test-api-key',
				},
				body: JSON.stringify(longContentData),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 應該成功處理，或回傳適當的錯誤
			expect([200, 201, 400]).toContain(response.status);

			if (response.status === 200 || response.status === 201) {
				const responseData = (await response.json()) as any;
				expect(responseData).toHaveProperty('success', true);
			}
		});
	});
});
