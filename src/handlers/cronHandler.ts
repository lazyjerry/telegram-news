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

			console.log(`找到 ${unpublishedPosts.length} 則待發布貼文，將合併為一則訊息發送`);

			// 2. 查詢所有確認且啟用的訂閱者
			const allActiveSubscriptions = await this.broadcastService.getAllActiveSubscriptions();

			if (allActiveSubscriptions.length === 0) {
				console.log('沒有有效的訂閱者，跳過推播');
				stats.executionTime = Date.now() - startTime;
				return stats;
			}

			console.log(`將發送給 ${allActiveSubscriptions.length} 個訂閱者`);

			// 3. 按訂閱者分組處理推播
			for (const subscription of allActiveSubscriptions) {
				try {
					// 確保訂閱者有 ID
					if (!subscription.id) {
						console.warn('跳過沒有 ID 的訂閱者');
						continue;
					}

					// 根據訂閱者的過濾條件篩選符合的貼文
					const eligiblePosts = await this.broadcastService.filterPostsForSubscription(unpublishedPosts, subscription);

					if (eligiblePosts.length === 0) {
						console.log(`訂閱者 ${subscription.chat_id} 沒有符合條件的貼文，跳過`);
						continue;
					}

					console.log(`\n--- 發送給訂閱者 ${subscription.chat_id}: ${eligiblePosts.length} 則新聞 ---`);

					stats.totalMessages++;

					// 應用速率限制
					await this.rateLimiter.waitForSend(subscription.chat_id);

					// 合併多則貼文為一則訊息發送
					const result = await this.telegramService.sendBatchNewsMessage(subscription.chat_id, eligiblePosts);

					if (result.success) {
						stats.successfulSends++;
						console.log(`✅ 成功發送到聊天 ${subscription.chat_id}`);

						// 為每則貼文記錄發送成功
						for (const post of eligiblePosts) {
							if (post.id) {
								await this.telegramService.recordDelivery(post.id, subscription.id, subscription.chat_id, true, undefined);
							}
						}
					} else {
						stats.failedSends++;
						console.log(`❌ 發送到聊天 ${subscription.chat_id} 失敗: ${result.error}`);

						// 為每則貼文記錄發送失敗
						for (const post of eligiblePosts) {
							if (post.id) {
								await this.telegramService.recordDelivery(post.id, subscription.id, subscription.chat_id, false, result.error);
							}
						}
					}
				} catch (error) {
					stats.failedSends++;
					const errorMsg = error instanceof Error ? error.message : '未知錯誤';
					console.error(`發送到聊天 ${subscription.chat_id} 時發生異常:`, errorMsg);

					// 為所有相關貼文記錄失敗
					const eligiblePosts = await this.broadcastService.filterPostsForSubscription(unpublishedPosts, subscription);
					for (const post of eligiblePosts) {
						if (post.id && subscription.id) {
							await this.telegramService.recordDelivery(post.id, subscription.id, subscription.chat_id, false, errorMsg);
						}
					}
				}
			}

			// 4. 檢查並標記已完成推播的貼文
			for (const post of unpublishedPosts) {
				try {
					if (!post.id) continue;

					stats.processedPosts++;

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

			// 5. 清理速率限制器記憶體
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
