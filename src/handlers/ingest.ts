/**
 * Telegram 新聞推播系統 - 新聞資料接收處理程式
 * 繁體中文說明：處理 POST /api/ingest 端點，驗證與處理外部新聞資料
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { PostService, type UpsertPostData } from '../services/postService';

// 請求資料格式定義（依據 spec.md 規範）
export interface IngestRequestBody {
	date: string; // 資料日期 YYYY-MM-DD
	results: IngestResult[]; // 新聞結果陣列
}

export interface IngestResult {
	username: string; // 新聞來源使用者名稱
	start?: string; // 活動開始日期 YYYY-MM-DD
	end?: string; // 活動結束日期 YYYY-MM-DD
	posts: IngestPost[]; // 新聞貼文陣列
}

export interface IngestPost {
	post_date: string; // 新聞發布日期 YYYY-MM-DD
	summary: string; // 新聞摘要
	url: string; // 新聞連結
	get_date: string; // 資料擷取日期 YYYY-MM-DD
}

// 回應格式定義
export interface IngestResponse {
	ok: boolean;
	inserted?: number; // 新增記錄數
	updated?: number; // 更新記錄數
	skipped?: number; // 跳過記錄數
	error?: string; // 錯誤訊息
	details?: string[]; // 詳細錯誤清單
}

/**
 * 驗證日期格式（YYYY-MM-DD）
 * @param dateString 日期字串
 * @returns 是否為有效日期格式
 */
function isValidDateFormat(dateString: string): boolean {
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateString)) {
		return false;
	}

	const date = new Date(dateString);
	return date instanceof Date && !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
}

/**
 * 驗證 URL 格式
 * @param url URL 字串
 * @returns 是否為有效 URL
 */
function isValidUrl(url: string): boolean {
	try {
		const urlObj = new URL(url);
		return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * 驗證請求資料格式
 * @param body 請求主體
 * @returns 驗證結果和錯誤訊息陣列
 */
function validateIngestRequest(body: any): { isValid: boolean; errors: string[] } {
	const errors: string[] = [];

	// 檢查根層級必要欄位
	if (!body.date) {
		errors.push('缺少必要欄位: date');
	} else if (typeof body.date !== 'string' || !isValidDateFormat(body.date)) {
		errors.push('date 格式無效，應為 YYYY-MM-DD 格式');
	}

	if (!body.results) {
		errors.push('缺少必要欄位: results');
	} else if (!Array.isArray(body.results)) {
		errors.push('results 必須為陣列格式');
	} else if (body.results.length === 0) {
		errors.push('results 陣列不能為空');
	} else if (body.results.length > 100) {
		errors.push('results 陣列長度不能超過 100');
	} else {
		// 檢查 results 陣列中的每個項目
		body.results.forEach((result: any, resultIndex: number) => {
			if (!result.username) {
				errors.push(`results[${resultIndex}]: 缺少必要欄位 username`);
			} else if (typeof result.username !== 'string' || result.username.length > 100) {
				errors.push(`results[${resultIndex}]: username 必須為字串且長度不超過 100`);
			}

			// 檢查可選的日期欄位
			if (result.start && (typeof result.start !== 'string' || !isValidDateFormat(result.start))) {
				errors.push(`results[${resultIndex}]: start 日期格式無效`);
			}

			if (result.end && (typeof result.end !== 'string' || !isValidDateFormat(result.end))) {
				errors.push(`results[${resultIndex}]: end 日期格式無效`);
			}

			// 檢查 posts 陣列
			if (!result.posts) {
				errors.push(`results[${resultIndex}]: 缺少必要欄位 posts`);
			} else if (!Array.isArray(result.posts)) {
				errors.push(`results[${resultIndex}]: posts 必須為陣列格式`);
			} else if (result.posts.length === 0) {
				errors.push(`results[${resultIndex}]: posts 陣列不能為空`);
			} else {
				// 檢查 posts 陣列中的每個項目
				result.posts.forEach((post: any, postIndex: number) => {
					const postPath = `results[${resultIndex}].posts[${postIndex}]`;

					// 檢查必要欄位
					if (!post.post_date) {
						errors.push(`${postPath}: 缺少必要欄位 post_date`);
					} else if (!isValidDateFormat(post.post_date)) {
						errors.push(`${postPath}: post_date 日期格式無效`);
					}

					if (!post.summary) {
						errors.push(`${postPath}: 缺少必要欄位 summary`);
					} else if (typeof post.summary !== 'string') {
						errors.push(`${postPath}: summary 必須為字串`);
					} else if (post.summary.length > 1000) {
						errors.push(`${postPath}: summary 長度不能超過 1000 個字元`);
					}

					if (!post.url) {
						errors.push(`${postPath}: 缺少必要欄位 url`);
					} else if (typeof post.url !== 'string') {
						errors.push(`${postPath}: url 必須為字串`);
					} else if (!isValidUrl(post.url)) {
						errors.push(`${postPath}: url 格式無效`);
					} else if (post.url.length > 500) {
						errors.push(`${postPath}: url 長度不能超過 500 個字元`);
					}

					if (!post.get_date) {
						errors.push(`${postPath}: 缺少必要欄位 get_date`);
					} else if (!isValidDateFormat(post.get_date)) {
						errors.push(`${postPath}: get_date 日期格式無效`);
					}
				});
			}
		});
	}

	return {
		isValid: errors.length === 0,
		errors,
	};
}

/**
 * 處理新聞資料接收請求
 * @param c Hono Context 物件
 * @returns Promise<Response> 處理結果回應
 */
export async function handleIngest(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		console.log('開始處理新聞資料接收請求:', new Date().toISOString());

		// 解析請求主體
		let body: IngestRequestBody;
		try {
			body = await c.req.json();
		} catch (error) {
			console.error('JSON 解析失敗:', error);
			return c.json(
				{
					ok: false,
					error: '無效的 JSON 格式',
					details: ['請確認請求主體為有效的 JSON 格式'],
				} as IngestResponse,
				400
			);
		}

		// 驗證請求資料
		const validation = validateIngestRequest(body);
		if (!validation.isValid) {
			console.error('請求資料驗證失敗:', validation.errors);
			return c.json(
				{
					ok: false,
					error: '請求資料格式無效',
					details: validation.errors,
				} as IngestResponse,
				400
			);
		}

		console.log(
			`請求資料驗證成功，包含 ${body.results.length} 個來源，` + `共 ${body.results.reduce((sum, r) => sum + r.posts.length, 0)} 則新聞`
		);

		// 初始化 PostService
		const postService = new PostService(c.env);

		// 處理每個來源的新聞資料
		let totalInserted = 0;
		let totalUpdated = 0;
		let totalSkipped = 0;
		const errors: string[] = [];

		for (const result of body.results) {
			try {
				// 轉換為 UPSERT 資料格式
				const postsData: UpsertPostData[] = result.posts.map((post) => ({
					source_username: result.username,
					start_date: result.start,
					end_date: result.end,
					post_date: post.post_date,
					summary: post.summary,
					url: post.url,
					get_date: post.get_date,
					filters_json: undefined, // 預設無篩選條件
				}));

				// 批次處理貼文
				const batchResult = await postService.batchUpsertPosts(postsData);

				totalInserted += batchResult.created;
				totalUpdated += batchResult.updated;
				totalSkipped += batchResult.skipped;
				errors.push(...batchResult.errors);

				console.log(
					`來源 ${result.username} 處理完成: 新增 ${batchResult.created}, 更新 ${batchResult.updated}, 跳過 ${batchResult.skipped}`
				);
			} catch (error) {
				const errorMsg = `處理來源 ${result.username} 時發生錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`;
				console.error(errorMsg);
				errors.push(errorMsg);
				totalSkipped += result.posts.length;
			}
		}

		// 建立回應
		const response: IngestResponse = {
			ok: true,
			inserted: totalInserted,
			updated: totalUpdated,
			skipped: totalSkipped,
		};

		// 如果有錯誤，添加錯誤詳情
		if (errors.length > 0) {
			response.details = errors;
		}

		console.log('新聞資料接收請求處理完成:', response);
		return c.json(response);
	} catch (error) {
		console.error('處理新聞資料接收請求時發生錯誤:', error);
		return c.json(
			{
				ok: false,
				error: '伺服器內部錯誤',
				details: [error instanceof Error ? error.message : '未知錯誤'],
			} as IngestResponse,
			500
		);
	}
}
