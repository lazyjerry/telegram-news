/**
 * Telegram 新聞推播系統 - 推播服務
 * 繁體中文說明：負責排程推播的核心業務邏輯，包含未發布貼文查詢與篩選
 */

import type { Env, Post, Subscription } from '../types';

/**
 * 推播服務類別，封裝所有推播相關的業務邏輯
 */
export class BroadcastService {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * 查詢未發布的貼文，按照發布時間排序
	 * @param limit 每批處理的數量上限，避免單次處理過多資料
	 * @returns Promise<Post[]> 待發布的貼文陣列
	 */
	async getUnpublishedPosts(limit: number = 50): Promise<Post[]> {
		try {
			console.log(`開始查詢未發布貼文，限制數量: ${limit}`);

			// 查詢條件：published = 0 且發布時間已到
			const currentTimestamp = Math.floor(Date.now() / 1000);

			const query = `
        SELECT 
          id, source_username, start_date, end_date, post_date, post_date_ts,
          summary, url, get_date, get_date_ts, published, published_at_ts,
          attempt_count, last_error, created_at_ts, updated_at_ts
        FROM posts 
        WHERE published = 0 
          AND (post_date_ts IS NULL OR post_date_ts <= ?)
        ORDER BY post_date_ts ASC, created_at_ts ASC
        LIMIT ?
      `;

			const result = await this.env.DB.prepare(query).bind(currentTimestamp, limit).all();

			const posts = result.results as unknown as Post[];
			console.log(`查詢完成，找到 ${posts.length} 則待發布貼文`);

			return posts;
		} catch (error) {
			console.error('查詢未發布貼文時發生錯誤:', error);
			throw new Error(`查詢未發布貼文失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
		}
	}

	/**
	 * 根據篩選條件查詢符合條件的訂閱者
	 * @param post 新聞貼文資料
	 * @returns Promise<Subscription[]> 符合條件的訂閱者陣列
	 */
	async getEligibleSubscriptions(post: Post): Promise<Subscription[]> {
		try {
			console.log(`查詢貼文 ${post.id} 的符合條件訂閱者`);

			// 基本查詢：啟用且已確認的訂閱
			let query = `
        SELECT 
          id, chat_id, enabled, confirmed, filters_json,
          created_at_ts, updated_at_ts, confirmed_at_ts
        FROM subscriptions 
        WHERE enabled = 1 AND confirmed = 1
      `;

			const result = await this.env.DB.prepare(query).all();
			let subscriptions = result.results as unknown as Subscription[];

			console.log(`找到 ${subscriptions.length} 個啟用的訂閱者`);

			// 應用篩選條件
			const filteredSubscriptions = this.applyFilters(subscriptions, post);

			console.log(`套用篩選條件後，符合條件的訂閱者: ${filteredSubscriptions.length} 個`);

			return filteredSubscriptions;
		} catch (error) {
			console.error('查詢符合條件訂閱者時發生錯誤:', error);
			throw new Error(`查詢訂閱者失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
		}
	}

	/**
	 * 應用 filters_json 篩選條件
	 * @param subscriptions 所有訂閱者
	 * @param post 新聞貼文
	 * @returns 符合篩選條件的訂閱者
	 */
	private applyFilters(subscriptions: Subscription[], post: Post): Subscription[] {
		return subscriptions.filter((subscription) => {
			try {
				// 如果沒有設定篩選條件，則發送給所有用戶
				if (!subscription.filters_json) {
					return true;
				}

				// 解析 JSON 篩選條件
				const filters = JSON.parse(subscription.filters_json);

				// 如果有指定 usernames 篩選條件
				if (filters.usernames && Array.isArray(filters.usernames)) {
					// 如果 usernames 陣列為空，發送給所有用戶
					if (filters.usernames.length === 0) {
						return true;
					}

					// 檢查貼文來源是否在篩選清單中
					return filters.usernames.includes(post.source_username);
				}

				// 沒有 usernames 篩選，發送給所有用戶
				return true;
			} catch (error) {
				console.warn(`解析訂閱者 ${subscription.id} 的篩選條件時發生錯誤:`, error);
				// 解析錯誤時，預設發送給該用戶
				return true;
			}
		});
	}

	/**
	 * 檢查特定貼文是否已完成發布
	 * @param postId 貼文 ID
	 * @returns Promise<boolean> 是否已完成發布
	 */
	async isPostFullyPublished(postId: number): Promise<boolean> {
		try {
			// 查詢應發送的數量（啟用且已確認的訂閱者）
			const expectedResult = await this.env.DB.prepare(
				`
        SELECT COUNT(*) as expected_count
        FROM subscriptions 
        WHERE enabled = 1 AND confirmed = 1
      `
			).first();

			const expectedCount = (expectedResult as { expected_count: number }).expected_count;

			// 查詢實際成功發送的數量
			const sentResult = await this.env.DB.prepare(
				`
        SELECT COUNT(*) as sent_count
        FROM deliveries 
        WHERE post_id = ? AND status = 'sent'
      `
			)
				.bind(postId)
				.first();

			const sentCount = (sentResult as { sent_count: number }).sent_count;

			console.log(`貼文 ${postId} 發送狀態: ${sentCount}/${expectedCount}`);

			return sentCount >= expectedCount && expectedCount > 0;
		} catch (error) {
			console.error(`檢查貼文 ${postId} 發布狀態時發生錯誤:`, error);
			return false;
		}
	}

	/**
	 * 更新貼文的發布狀態為已完成
	 * @param postId 貼文 ID
	 */
	async markPostAsPublished(postId: number): Promise<void> {
		try {
			const currentTimestamp = Math.floor(Date.now() / 1000);

			await this.env.DB.prepare(
				`
        UPDATE posts 
        SET published = 1, 
            published_at_ts = ?,
            updated_at_ts = ?
        WHERE id = ?
      `
			)
				.bind(currentTimestamp, currentTimestamp, postId)
				.run();

			console.log(`貼文 ${postId} 已標記為發布完成`);
		} catch (error) {
			console.error(`更新貼文 ${postId} 發布狀態時發生錯誤:`, error);
			throw error;
		}
	}

	/**
	 * 增加貼文的推播嘗試次數
	 * @param postId 貼文 ID
	 * @param errorMessage 錯誤訊息
	 */
	async incrementAttemptCount(postId: number, errorMessage?: string): Promise<void> {
		try {
			const currentTimestamp = Math.floor(Date.now() / 1000);

			await this.env.DB.prepare(
				`
        UPDATE posts 
        SET attempt_count = attempt_count + 1,
            last_error = ?,
            updated_at_ts = ?
        WHERE id = ?
      `
			)
				.bind(errorMessage || null, currentTimestamp, postId)
				.run();

			console.log(`貼文 ${postId} 嘗試次數已增加`);
		} catch (error) {
			console.error(`更新貼文 ${postId} 嘗試次數時發生錯誤:`, error);
		}
	}
}
