/**
 * Telegram 新聞推播系統 - 貼文管理服務
 * 繁體中文說明：處理貼文的建立、更新與 UPSERT 邏輯
 */

import type { Env, Post } from '../types';
import { parsePublishTime, validateTimestamp, getCurrentTimestamp } from '../utils/timeUtils';

/**
 * 貼文操作結果介面
 */
export interface PostOperationResult {
	success: boolean;
	postId?: number;
	operation: 'created' | 'updated' | 'skipped';
	error?: string;
}

/**
 * UPSERT 貼文資料介面
 */
export interface UpsertPostData {
	source_username: string;
	start_date?: string;
	end_date?: string;
	post_date: string;
	summary: string;
	url: string;
	get_date: string;
	filters_json?: string; // JSON 格式的篩選條件
}

/**
 * 貼文管理服務類別
 */
export class PostService {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * UPSERT 貼文資料：存在則更新，不存在則新增
	 * @param postData 貼文資料
	 * @returns Promise<PostOperationResult> 操作結果
	 */
	async upsertPost(postData: UpsertPostData): Promise<PostOperationResult> {
		try {
			console.log(`開始 UPSERT 貼文，URL: ${postData.url}`);

			// 1. 解析和驗證發布時間
			const postDateTimestamp = parsePublishTime(postData.post_date);
			if (!postDateTimestamp) {
				return {
					success: false,
					operation: 'skipped',
					error: `無效的 post_date 格式: ${postData.post_date}`,
				};
			}

			// 驗證時間範圍
			if (!validateTimestamp(postDateTimestamp)) {
				return {
					success: false,
					operation: 'skipped',
					error: `post_date 超出允許範圍: ${postData.post_date}`,
				};
			}

			// 2. 解析其他日期欄位
			const getDateTimestamp = parsePublishTime(postData.get_date);
			if (!getDateTimestamp) {
				return {
					success: false,
					operation: 'skipped',
					error: `無效的 get_date 格式: ${postData.get_date}`,
				};
			}

			let startDateTimestamp: number | null = null;
			let endDateTimestamp: number | null = null;

			if (postData.start_date) {
				startDateTimestamp = parsePublishTime(postData.start_date);
				if (!startDateTimestamp) {
					return {
						success: false,
						operation: 'skipped',
						error: `無效的 start_date 格式: ${postData.start_date}`,
					};
				}
			}

			if (postData.end_date) {
				endDateTimestamp = parsePublishTime(postData.end_date);
				if (!endDateTimestamp) {
					return {
						success: false,
						operation: 'skipped',
						error: `無效的 end_date 格式: ${postData.end_date}`,
					};
				}
			}

			// 3. 檢查是否已存在相同 URL 的貼文
			const existingPost = await this.findPostByUrl(postData.url);
			const currentTimestamp = getCurrentTimestamp();

			if (existingPost) {
				// 4. 更新現有貼文
				console.log(`發現現有貼文 ID ${existingPost.id}，執行更新操作`);

				await this.env.DB.prepare(
					`
          UPDATE posts SET
            source_username = ?,
            start_date = ?,
            end_date = ?,
            post_date = ?,
            post_date_ts = ?,
            summary = ?,
            get_date = ?,
            get_date_ts = ?,
            filters_json = ?,
            updated_at_ts = ?
          WHERE id = ?
        `
				)
					.bind(
						postData.source_username,
						postData.start_date || null,
						postData.end_date || null,
						postData.post_date,
						postDateTimestamp,
						postData.summary,
						postData.get_date,
						getDateTimestamp,
						postData.filters_json || null,
						currentTimestamp,
						existingPost.id
					)
					.run();

				console.log(`成功更新貼文 ID ${existingPost.id}`);
				return {
					success: true,
					postId: existingPost.id,
					operation: 'updated',
				};
			} else {
				// 5. 建立新貼文
				console.log(`建立新貼文，URL: ${postData.url}`);

				const result = await this.env.DB.prepare(
					`
          INSERT INTO posts (
            source_username, start_date, end_date, post_date, post_date_ts,
            summary, url, get_date, get_date_ts, filters_json,
            published, published_at_ts, attempt_count, last_error,
            created_at_ts, updated_at_ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?, ?)
        `
				)
					.bind(
						postData.source_username,
						postData.start_date || null,
						postData.end_date || null,
						postData.post_date,
						postDateTimestamp,
						postData.summary,
						postData.url,
						postData.get_date,
						getDateTimestamp,
						postData.filters_json || null,
						currentTimestamp,
						currentTimestamp
					)
					.run();

				const newPostId = result.meta.last_row_id as number;
				console.log(`成功建立新貼文 ID ${newPostId}`);

				return {
					success: true,
					postId: newPostId,
					operation: 'created',
				};
			}
		} catch (error) {
			const errorMsg = `UPSERT 貼文失敗: ${error instanceof Error ? error.message : '未知錯誤'}`;
			console.error(errorMsg, error);

			return {
				success: false,
				operation: 'skipped',
				error: errorMsg,
			};
		}
	}

	/**
	 * 根據 URL 查詢現有貼文
	 * @param url 貼文 URL
	 * @returns Promise<Post | null> 找到的貼文或 null
	 */
	private async findPostByUrl(url: string): Promise<Post | null> {
		try {
			const result = await this.env.DB.prepare('SELECT * FROM posts WHERE url = ? LIMIT 1').bind(url).first();

			return result ? (result as unknown as Post) : null;
		} catch (error) {
			console.error('查詢貼文失敗:', error);
			return null;
		}
	}

	/**
	 * 根據 ID 查詢貼文
	 * @param postId 貼文 ID
	 * @returns Promise<Post | null> 找到的貼文或 null
	 */
	async getPostById(postId: number): Promise<Post | null> {
		try {
			const result = await this.env.DB.prepare('SELECT * FROM posts WHERE id = ? LIMIT 1').bind(postId).first();

			return result ? (result as unknown as Post) : null;
		} catch (error) {
			console.error('根據 ID 查詢貼文失敗:', error);
			return null;
		}
	}

	/**
	 * 查詢指定來源的所有貼文
	 * @param sourceUsername 來源使用者名稱
	 * @param limit 數量限制（預設 50）
	 * @returns Promise<Post[]> 貼文陣列
	 */
	async getPostsBySource(sourceUsername: string, limit: number = 50): Promise<Post[]> {
		try {
			const result = await this.env.DB.prepare(
				`
        SELECT * FROM posts 
        WHERE source_username = ? 
        ORDER BY post_date_ts DESC, created_at_ts DESC 
        LIMIT ?
      `
			)
				.bind(sourceUsername, limit)
				.all();

			return result.results as unknown as Post[];
		} catch (error) {
			console.error('查詢來源貼文失敗:', error);
			return [];
		}
	}

	/**
	 * 批次 UPSERT 多篇貼文
	 * @param postsData 貼文資料陣列
	 * @returns Promise<BatchUpsertResult> 批次操作結果
	 */
	async batchUpsertPosts(postsData: UpsertPostData[]): Promise<BatchUpsertResult> {
		const result: BatchUpsertResult = {
			total: postsData.length,
			created: 0,
			updated: 0,
			skipped: 0,
			errors: [],
		};

		console.log(`開始批次 UPSERT ${postsData.length} 篇貼文`);

		for (let i = 0; i < postsData.length; i++) {
			const postData = postsData[i];

			try {
				const operationResult = await this.upsertPost(postData);

				if (operationResult.success) {
					switch (operationResult.operation) {
						case 'created':
							result.created++;
							break;
						case 'updated':
							result.updated++;
							break;
						case 'skipped':
							result.skipped++;
							break;
					}
				} else {
					result.skipped++;
					result.errors.push(`貼文 ${i + 1} (${postData.url}): ${operationResult.error}`);
				}
			} catch (error) {
				result.skipped++;
				const errorMsg = `貼文 ${i + 1} 處理失敗: ${error instanceof Error ? error.message : '未知錯誤'}`;
				result.errors.push(errorMsg);
				console.error(errorMsg, error);
			}
		}

		console.log(`批次 UPSERT 完成: 新增 ${result.created}, 更新 ${result.updated}, 跳過 ${result.skipped}, 錯誤 ${result.errors.length}`);

		return result;
	}

	/**
	 * 軟刪除貼文（標記為刪除，不實際刪除）
	 * @param postId 貼文 ID
	 * @returns Promise<boolean> 操作是否成功
	 */
	async softDeletePost(postId: number): Promise<boolean> {
		try {
			const currentTimestamp = getCurrentTimestamp();

			await this.env.DB.prepare(
				`
        UPDATE posts 
        SET last_error = 'SOFT_DELETED', 
            updated_at_ts = ? 
        WHERE id = ?
      `
			)
				.bind(currentTimestamp, postId)
				.run();

			console.log(`貼文 ${postId} 已標記為軟刪除`);
			return true;
		} catch (error) {
			console.error(`軟刪除貼文 ${postId} 失敗:`, error);
			return false;
		}
	}
}

/**
 * 批次 UPSERT 操作結果介面
 */
export interface BatchUpsertResult {
	total: number;
	created: number;
	updated: number;
	skipped: number;
	errors: string[];
}
