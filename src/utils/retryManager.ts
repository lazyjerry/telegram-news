/**
 * 失敗投遞自動重試系統
 *
 * 負責處理投遞失敗的自動重試邏輯，包括：
 * - 查詢失敗的投遞記錄
 * - 實作智能重試策略
 * - 管理重試佇列
 * - 監控重試成功率
 */

import { ErrorLogger, ErrorAnalyzer, ErrorType, ErrorSeverity } from './errorLogger';
import { withTelegramRetry } from './retry';
import { TelegramApiService } from '../services/telegramApi';

/**
 * 重試策略枚舉
 */
export enum RetryStrategy {
	/** 立即重試 */
	IMMEDIATE = 'IMMEDIATE',
	/** 延遲重試 */
	DELAYED = 'DELAYED',
	/** 停止重試 */
	STOP = 'STOP',
	/** 停用訂閱 */
	DISABLE_SUBSCRIPTION = 'DISABLE_SUBSCRIPTION',
}

/**
 * 重試決策結果
 */
export interface RetryDecision {
	/** 重試策略 */
	strategy: RetryStrategy;
	/** 延遲時間（毫秒），如果是延遲重試 */
	delay?: number;
	/** 決策原因 */
	reason: string;
	/** 是否為最終決策（不再重試） */
	final: boolean;
}

/**
 * 失敗投遞記錄介面
 */
export interface FailedDelivery {
	/** 投遞 ID */
	id: number;
	/** 貼文 ID */
	postId: number;
	/** 聊天 ID */
	chatId: number;
	/** 當前重試次數 */
	retryCount: number;
	/** 最後重試時間戳 */
	lastRetryTs?: number;
	/** 錯誤資訊 */
	error?: string;
	/** 投遞狀態 */
	status: string;
	/** 建立時間 */
	createdTs: number;
}

/**
 * 重試配置
 */
export interface RetryConfig {
	/** 最大重試次數 */
	maxRetries: number;
	/** 重試間隔（毫秒） */
	retryInterval: number;
	/** 批次處理大小 */
	batchSize: number;
	/** 是否啟用自動重試 */
	enabled: boolean;
}

/**
 * 預設重試配置
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	retryInterval: 5 * 60 * 1000, // 5 分鐘
	batchSize: 50,
	enabled: true,
};

/**
 * 重試決策引擎
 */
export class RetryDecisionEngine {
	/**
	 * 根據錯誤資訊決定重試策略
	 * @param delivery 失敗的投遞記錄
	 * @param error 標準化錯誤資訊
	 * @param config 重試配置
	 * @returns 重試決策
	 */
	static decide(delivery: FailedDelivery, error: any, config: RetryConfig = DEFAULT_RETRY_CONFIG): RetryDecision {
		// 檢查是否已達最大重試次數
		if (delivery.retryCount >= config.maxRetries) {
			return {
				strategy: RetryStrategy.STOP,
				reason: `已達最大重試次數 (${config.maxRetries})`,
				final: true,
			};
		}

		// 分析錯誤並決定策略
		const standardError = ErrorAnalyzer.analyzeError(error, {
			operation: 'delivery_retry_decision',
			entityId: delivery.id,
		});

		switch (standardError.type) {
			case ErrorType.NETWORK_ERROR:
				return {
					strategy: RetryStrategy.IMMEDIATE,
					reason: '網路錯誤，立即重試',
					final: false,
				};

			case ErrorType.RATE_LIMIT_ERROR:
				const retryAfter = error?.parameters?.retry_after || 60;
				return {
					strategy: RetryStrategy.DELAYED,
					delay: retryAfter * 1000, // 轉換為毫秒
					reason: `速率限制，等待 ${retryAfter} 秒後重試`,
					final: false,
				};

			case ErrorType.USER_BLOCKED_BOT:
				return {
					strategy: RetryStrategy.DISABLE_SUBSCRIPTION,
					reason: '用戶封鎖機器人，停用該訂閱',
					final: true,
				};

			case ErrorType.CHAT_NOT_FOUND:
				return {
					strategy: RetryStrategy.DISABLE_SUBSCRIPTION,
					reason: '聊天不存在或機器人被移除，停用該訂閱',
					final: true,
				};

			case ErrorType.TELEGRAM_API_ERROR:
				const errorCode = error?.error_code || 0;

				// 4xx 客戶端錯誤，通常不應重試
				if (errorCode >= 400 && errorCode < 500) {
					if (errorCode === 429) {
						// 429 已在上面 RATE_LIMIT_ERROR 處理
						break;
					}
					return {
						strategy: RetryStrategy.STOP,
						reason: `客戶端錯誤 [${errorCode}]，不重試`,
						final: true,
					};
				}

				// 5xx 伺服器錯誤，可以重試
				if (errorCode >= 500) {
					return {
						strategy: RetryStrategy.DELAYED,
						delay: config.retryInterval,
						reason: `伺服器錯誤 [${errorCode}]，延遲重試`,
						final: false,
					};
				}
				break;

			case ErrorType.DATABASE_ERROR:
				return {
					strategy: RetryStrategy.DELAYED,
					delay: config.retryInterval,
					reason: '資料庫錯誤，延遲重試',
					final: false,
				};

			default:
				// 未知錯誤，謹慎處理
				if (standardError.retryable) {
					return {
						strategy: RetryStrategy.DELAYED,
						delay: config.retryInterval,
						reason: '未知錯誤但標記為可重試',
						final: false,
					};
				}
		}

		return {
			strategy: RetryStrategy.STOP,
			reason: '錯誤不適合重試',
			final: true,
		};
	}
}

/**
 * 失敗投遞重試管理器
 */
export class FailedDeliveryRetryManager {
	private errorLogger: ErrorLogger;

	constructor(private db: D1Database, private telegramApi: TelegramApiService, private config: RetryConfig = DEFAULT_RETRY_CONFIG) {
		this.errorLogger = new ErrorLogger(db);
	}

	/**
	 * 查詢需要重試的失敗投遞
	 * @returns 失敗投遞記錄列表
	 */
	async getFailedDeliveries(): Promise<FailedDelivery[]> {
		const now = Date.now();
		const cutoff = now - this.config.retryInterval;

		try {
			const result = await this.db
				.prepare(
					`
        SELECT 
          id, post_id, chat_id, retry_count, 
          last_retry_ts, error, status, created_ts
        FROM deliveries 
        WHERE 
          status = 'failed' 
          AND retry_count < ? 
          AND (last_retry_ts IS NULL OR last_retry_ts < ?)
        ORDER BY created_ts ASC
        LIMIT ?
      `
				)
				.bind(this.config.maxRetries, cutoff, this.config.batchSize)
				.all();

			return (result.results || []).map((row) => ({
				id: row.id as number,
				postId: row.post_id as number,
				chatId: row.chat_id as number,
				retryCount: row.retry_count as number,
				lastRetryTs: (row.last_retry_ts as number) || undefined,
				error: (row.error as string) || undefined,
				status: row.status as string,
				createdTs: row.created_ts as number,
			}));
		} catch (error) {
			console.error('查詢失敗投遞記錄時發生錯誤:', error);
			return [];
		}
	}

	/**
	 * 執行單個投遞的重試
	 * @param delivery 投遞記錄
	 * @returns 重試結果
	 */
	async retryDelivery(delivery: FailedDelivery): Promise<{
		success: boolean;
		decision?: RetryDecision;
		error?: any;
	}> {
		console.log(`開始重試投遞 [ID: ${delivery.id}, Chat: ${delivery.chatId}, 重試次數: ${delivery.retryCount + 1}]`);

		try {
			// 取得貼文資訊
			const postResult = await this.db
				.prepare(
					`
        SELECT title, content, url FROM posts WHERE id = ?
      `
				)
				.bind(delivery.postId)
				.first();

			if (!postResult) {
				console.error(`找不到貼文 [ID: ${delivery.postId}]`);
				return { success: false, error: new Error('貼文不存在') };
			}

			// 嘗試重新發送訊息
			const result = await withTelegramRetry(
				async () => {
					// 格式化訊息內容
					const messageText = `<b>${postResult.title}</b>\n\n${postResult.content}\n\n🔗 <a href="${postResult.url}">查看完整內容</a>`;

					return this.telegramApi.sendMessage(delivery.chatId.toString(), messageText);
				},
				{
					maxRetries: 1, // 這裡只嘗試 1 次，因為外層已經有重試邏輯
				}
			);

			if (result.success) {
				// 投遞成功，更新狀態
				await this.updateDeliverySuccess(delivery.id);
				await this.errorLogger.clearDeliveryError(delivery.id);

				console.log(`投遞重試成功 [ID: ${delivery.id}]`);
				return { success: true };
			}
		} catch (error) {
			console.warn(`投遞重試失敗 [ID: ${delivery.id}]:`, error);

			// 分析錯誤並決定下一步行動
			const decision = RetryDecisionEngine.decide(delivery, error, this.config);

			await this.handleRetryDecision(delivery, decision, error);

			return {
				success: false,
				decision,
				error,
			};
		}

		return { success: false };
	}

	/**
	 * 處理重試決策
	 * @param delivery 投遞記錄
	 * @param decision 重試決策
	 * @param error 錯誤資訊
	 */
	private async handleRetryDecision(delivery: FailedDelivery, decision: RetryDecision, error: any): Promise<void> {
		const now = Date.now();

		switch (decision.strategy) {
			case RetryStrategy.STOP:
				// 停止重試，標記為永久失敗
				await this.db
					.prepare(
						`
          UPDATE deliveries 
          SET 
            status = 'permanently_failed',
            updated_ts = ?
          WHERE id = ?
        `
					)
					.bind(now, delivery.id)
					.run();

				console.log(`投遞永久失敗 [ID: ${delivery.id}]: ${decision.reason}`);
				break;

			case RetryStrategy.DISABLE_SUBSCRIPTION:
				// 停用相關訂閱
				await this.disableSubscription(delivery.chatId, decision.reason);

				await this.db
					.prepare(
						`
          UPDATE deliveries 
          SET 
            status = 'subscription_disabled',
            updated_ts = ?
          WHERE id = ?
        `
					)
					.bind(now, delivery.id)
					.run();

				console.log(`訂閱已停用 [Chat: ${delivery.chatId}]: ${decision.reason}`);
				break;

			case RetryStrategy.IMMEDIATE:
			case RetryStrategy.DELAYED:
				// 更新重試計數和時間戳
				await this.db
					.prepare(
						`
          UPDATE deliveries 
          SET 
            retry_count = retry_count + 1,
            last_retry_ts = ?,
            updated_ts = ?
          WHERE id = ?
        `
					)
					.bind(now, now, delivery.id)
					.run();

				// 記錄錯誤
				const standardError = ErrorAnalyzer.analyzeError(error, {
					operation: 'delivery_retry',
					entityId: delivery.id,
				});

				await this.errorLogger.logDeliveryError(delivery.id, standardError);

				console.log(`重試排程 [ID: ${delivery.id}]: ${decision.reason}`);
				break;
		}
	}

	/**
	 * 更新投遞為成功狀態
	 * @param deliveryId 投遞 ID
	 */
	private async updateDeliverySuccess(deliveryId: number): Promise<void> {
		const now = Date.now();

		await this.db
			.prepare(
				`
      UPDATE deliveries 
      SET 
        status = 'sent',
        sent_ts = ?,
        updated_ts = ?,
        error = NULL
      WHERE id = ?
    `
			)
			.bind(now, now, deliveryId)
			.run();
	}

	/**
	 * 停用訂閱
	 * @param chatId 聊天 ID
	 * @param reason 停用原因
	 */
	private async disableSubscription(chatId: number, reason: string): Promise<void> {
		const now = Date.now();

		try {
			await this.db
				.prepare(
					`
        UPDATE subscriptions 
        SET 
          status = 'disabled',
          disabled_reason = ?,
          updated_ts = ?
        WHERE chat_id = ?
      `
				)
				.bind(reason, now, chatId)
				.run();

			console.log(`訂閱已停用 [Chat: ${chatId}]: ${reason}`);
		} catch (error) {
			console.error(`停用訂閱失敗 [Chat: ${chatId}]:`, error);
		}
	}

	/**
	 * 批次處理失敗投遞重試
	 * @returns 處理結果統計
	 */
	async processFailedDeliveries(): Promise<{
		processed: number;
		succeeded: number;
		failed: number;
		disabled: number;
	}> {
		if (!this.config.enabled) {
			console.log('自動重試功能已停用');
			return { processed: 0, succeeded: 0, failed: 0, disabled: 0 };
		}

		const failedDeliveries = await this.getFailedDeliveries();

		if (failedDeliveries.length === 0) {
			console.log('沒有需要重試的失敗投遞');
			return { processed: 0, succeeded: 0, failed: 0, disabled: 0 };
		}

		console.log(`開始處理 ${failedDeliveries.length} 個失敗投遞`);

		let succeeded = 0;
		let failed = 0;
		let disabled = 0;

		// 逐一處理，避免併發造成的問題
		for (const delivery of failedDeliveries) {
			try {
				const result = await this.retryDelivery(delivery);

				if (result.success) {
					succeeded++;
				} else if (result.decision?.strategy === RetryStrategy.DISABLE_SUBSCRIPTION) {
					disabled++;
				} else {
					failed++;
				}

				// 在處理之間稍微延遲，避免對 Telegram API 造成過大壓力
				await new Promise((resolve) => setTimeout(resolve, 100));
			} catch (error) {
				console.error(`處理失敗投遞時發生意外錯誤 [ID: ${delivery.id}]:`, error);
				failed++;
			}
		}

		const stats = {
			processed: failedDeliveries.length,
			succeeded,
			failed,
			disabled,
		};

		console.log(`失敗投遞重試完成:`, stats);
		return stats;
	}

	/**
	 * 獲取重試統計資訊
	 * @param timeRange 時間範圍（毫秒）
	 * @returns 重試統計
	 */
	async getRetryStats(timeRange: number = 24 * 60 * 60 * 1000): Promise<{
		totalRetries: number;
		successfulRetries: number;
		failedRetries: number;
		disabledSubscriptions: number;
		successRate: number;
	}> {
		const since = Date.now() - timeRange;

		try {
			// 統計重試次數
			const retryResult = await this.db
				.prepare(
					`
        SELECT 
          COUNT(*) as total_retries,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as successful_retries
        FROM deliveries 
        WHERE 
          retry_count > 0 
          AND updated_ts >= ?
      `
				)
				.bind(since)
				.first();

			// 統計停用的訂閱
			const disabledResult = await this.db
				.prepare(
					`
        SELECT COUNT(*) as disabled_subscriptions
        FROM subscriptions 
        WHERE 
          status = 'disabled' 
          AND updated_ts >= ?
      `
				)
				.bind(since)
				.first();

			const totalRetries = (retryResult?.total_retries as number) || 0;
			const successfulRetries = (retryResult?.successful_retries as number) || 0;
			const disabledSubscriptions = (disabledResult?.disabled_subscriptions as number) || 0;
			const failedRetries = totalRetries - successfulRetries;
			const successRate = totalRetries > 0 ? (successfulRetries / totalRetries) * 100 : 0;

			return {
				totalRetries,
				successfulRetries,
				failedRetries,
				disabledSubscriptions,
				successRate: Math.round(successRate * 100) / 100,
			};
		} catch (error) {
			console.error('獲取重試統計失敗:', error);
			return {
				totalRetries: 0,
				successfulRetries: 0,
				failedRetries: 0,
				disabledSubscriptions: 0,
				successRate: 0,
			};
		}
	}
}
