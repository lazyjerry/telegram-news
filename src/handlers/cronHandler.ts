/**
 * Telegram 新聞推播系統 - Cron 排程處理程式
 * 繁體中文說明：處理 Cloudflare Workers 的 scheduled 事件，執行自動推播任務
 */

import type { Env } from '../types';
import { BroadcastService } from '../services/broadcastService';
import { TelegramApiService } from '../services/telegramApi';
import { RateLimiterManager } from '../utils/rateLimiter';

/**
 * 推播統計資訊
 */
interface BroadcastStats {
	processedPosts: number;
	totalMessages: number;
	successfulSends: number;
	failedSends: number;
	skippedPosts: number;
	executionTime: number;
}

/**
 * Cron 排程處理器類別
 */
export class CronHandler {
	private env: Env;
	private broadcastService: BroadcastService;
	private telegramService: TelegramApiService;
	private rateLimiter: RateLimiterManager;

	constructor(env: Env) {
		this.env = env;
		this.broadcastService = new BroadcastService(env);
		this.telegramService = new TelegramApiService(env);
		this.rateLimiter = new RateLimiterManager();
	}

	/**
	 * 執行排程推播任務
	 * @returns Promise<BroadcastStats> 推播統計結果
	 */
	async executeBroadcast(): Promise<BroadcastStats> {
		const startTime = Date.now();
		const stats: BroadcastStats = {
			processedPosts: 0,
			totalMessages: 0,
			successfulSends: 0,
			failedSends: 0,
			skippedPosts: 0,
			executionTime: 0,
		};

		try {
			console.log('=== 開始執行推播任務 ===', new Date().toISOString());

			// 1. 查詢未發布的貼文
			const unpublishedPosts = await this.broadcastService.getUnpublishedPosts(20);

			if (unpublishedPosts.length === 0) {
				console.log('沒有待發布的貼文，推播任務結束');
				stats.executionTime = Date.now() - startTime;
				return stats;
			}

			console.log(`找到 ${unpublishedPosts.length} 則待發布貼文`);

			// 2. 逐一處理每則貼文
			for (const post of unpublishedPosts) {
				try {
					// 確保貼文有 ID
					if (!post.id) {
						console.warn('跳過沒有 ID 的貼文');
						continue;
					}

					stats.processedPosts++;
					console.log(`\n--- 處理貼文 ${post.id}: ${post.summary?.substring(0, 50)}... ---`);

					// 3. 查詢符合條件的訂閱者
					const eligibleSubscriptions = await this.broadcastService.getEligibleSubscriptions(post);

					if (eligibleSubscriptions.length === 0) {
						console.log(`貼文 ${post.id} 沒有符合條件的訂閱者，跳過`);
						stats.skippedPosts++;

						// 標記為已發布（避免重複處理）
						await this.broadcastService.markPostAsPublished(post.id);
						continue;
					}

					console.log(`貼文 ${post.id} 將發送給 ${eligibleSubscriptions.length} 個訂閱者`);

					// 4. 發送訊息給每個符合條件的訂閱者
					for (const subscription of eligibleSubscriptions) {
						try {
							// 確保訂閱者有 ID
							if (!subscription.id) {
								console.warn('跳過沒有 ID 的訂閱者');
								continue;
							}

							stats.totalMessages++;

							// 應用速率限制
							await this.rateLimiter.waitForSend(subscription.chat_id);

							// 發送訊息
							const result = await this.telegramService.sendNewsMessage(subscription.chat_id, post);

							// 記錄發送結果
							await this.telegramService.recordDelivery(post.id, subscription.id, subscription.chat_id, result.success, result.error);

							if (result.success) {
								stats.successfulSends++;
								console.log(`✅ 成功發送到聊天 ${subscription.chat_id}`);
							} else {
								stats.failedSends++;
								console.log(`❌ 發送到聊天 ${subscription.chat_id} 失敗: ${result.error}`);
							}
						} catch (error) {
							stats.failedSends++;
							const errorMsg = error instanceof Error ? error.message : '未知錯誤';
							console.error(`發送到聊天 ${subscription.chat_id} 時發生異常:`, errorMsg);

							// 記錄失敗 (只有在有 subscription.id 時)
							if (subscription.id) {
								await this.telegramService.recordDelivery(post.id, subscription.id, subscription.chat_id, false, errorMsg);
							}
						}
					}

					// 5. 檢查是否所有訂閱者都已發送完成
					const isFullyPublished = await this.broadcastService.isPostFullyPublished(post.id);

					if (isFullyPublished) {
						await this.broadcastService.markPostAsPublished(post.id);
						console.log(`✅ 貼文 ${post.id} 已標記為發布完成`);
					} else {
						// 增加嘗試次數，記錄部分失敗情況
						await this.broadcastService.incrementAttemptCount(post.id, '部分訂閱者發送失敗');
						console.log(`⚠️  貼文 ${post.id} 部分發送失敗，已增加嘗試次數`);
					}
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : '未知錯誤';
					console.error(`處理貼文 ${post.id} 時發生錯誤:`, errorMsg);

					// 記錄錯誤並增加嘗試次數（確保有 post.id）
					if (post.id) {
						await this.broadcastService.incrementAttemptCount(post.id, errorMsg);
					}
				}
			}

			// 6. 清理速率限制器記憶體
			this.rateLimiter.cleanupInactiveLimiters();
		} catch (error) {
			console.error('執行推播任務時發生嚴重錯誤:', error);
			throw error;
		} finally {
			stats.executionTime = Date.now() - startTime;

			console.log('\n=== 推播任務執行完成 ===');
			console.log(`執行時間: ${stats.executionTime}ms`);
			console.log(`處理貼文: ${stats.processedPosts} 則`);
			console.log(`總訊息數: ${stats.totalMessages} 則`);
			console.log(`成功發送: ${stats.successfulSends} 則`);
			console.log(`發送失敗: ${stats.failedSends} 則`);
			console.log(`跳過貼文: ${stats.skippedPosts} 則`);
			console.log('============================\n');
		}

		return stats;
	}

	/**
	 * 驗證推播系統狀態
	 * @returns Promise<boolean> 系統是否正常
	 */
	async validateBroadcastSystem(): Promise<boolean> {
		try {
			console.log('檢查推播系統狀態...');

			// 1. 檢查 Telegram Bot Token
			const tokenValid = await this.telegramService.validateBotToken();
			if (!tokenValid) {
				console.error('❌ Telegram Bot Token 無效');
				return false;
			}

			// 2. 檢查資料庫連線
			try {
				await this.env.DB.prepare('SELECT 1').first();
				console.log('✅ 資料庫連線正常');
			} catch (error) {
				console.error('❌ 資料庫連線失敗:', error);
				return false;
			}

			// 3. 檢查必要的環境變數
			const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'API_KEY'];
			for (const envVar of requiredEnvVars) {
				if (!this.env[envVar as keyof Env]) {
					console.error(`❌ 缺少必要的環境變數: ${envVar}`);
					return false;
				}
			}

			console.log('✅ 推播系統狀態檢查通過');
			return true;
		} catch (error) {
			console.error('檢查推播系統狀態時發生錯誤:', error);
			return false;
		}
	}
}
