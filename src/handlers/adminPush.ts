/**
 * 管理員手動推播處理器
 *
 * 提供管理員手動觸發推播功能，包括：
 * - 指定貼文推播
 * - 推播範圍篩選
 * - 乾跑模式預覽
 * - 推播狀態監控
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { BroadcastService } from '../services/broadcastService';
import { TelegramApiService } from '../services/telegramApi';
import { logger, LogComponent } from '../utils/logger';
import { handleError, ErrorLogger } from '../utils/errorLogger';

/**
 * 手動推播請求介面
 */
export interface ManualPushRequest {
	/** 貼文 ID（選填，未提供則推播所有未發布的） */
	postId?: number;
	/** 聊天 ID 篩選（選填，推播給特定用戶） */
	chatIds?: number[];
	/** 是否乾跑模式（不實際發送） */
	dryRun?: boolean;
	/** 強制推播（即使已發布） */
	force?: boolean;
	/** 篩選條件覆蓋 */
	filterOverride?: {
		usernames?: string[];
	};
}

/**
 * 推播結果介面
 */
export interface PushResult {
	/** 推播 ID */
	pushId: string;
	/** 是否為乾跑模式 */
	dryRun: boolean;
	/** 處理的貼文數量 */
	postsProcessed: number;
	/** 目標用戶數量 */
	targetUsers: number;
	/** 實際發送數量 */
	messagesSent: number;
	/** 失敗數量 */
	messagesFailed: number;
	/** 執行時間（毫秒） */
	duration: number;
	/** 推播詳情 */
	details: {
		posts: Array<{
			postId: number;
			title: string;
			targetUsers: number;
			successCount: number;
			failureCount: number;
			/** 乾跑模式下的訊息預覽 */
			messagePreview?: string;
			/** 目標用戶預覽 */
			userPreview?: Array<{
				chatId: number;
				username: string | null;
			}>;
		}>;
		/** 跳過的原因（如果有） */
		skipped?: Array<{
			postId: number;
			title: string;
			reason: string;
		}>;
		/** 乾跑模式執行計劃 */
		executionPlan?: {
			/** 執行步驟 */
			steps: Array<{
				step: string;
				description: string;
				affectedCount: number;
			}>;
			/** 篩選結果統計 */
			filterStats: {
				totalSubscriptions: number;
				activeSubscriptions: number;
				filteredUsers: number;
				filterCriteria?: string;
			};
			/** 預估執行時間（秒） */
			estimatedDuration: number;
		};
		/** 潛在問題警告 */
		warnings?: string[];
	};
	/** 錯誤資訊（如果有） */
	errors?: string[];
}

/**
 * 管理員推播服務
 */
export class AdminPushService {
	private broadcastService: BroadcastService;
	private telegramApi: TelegramApiService;
	private errorLogger: ErrorLogger;
	private logger = logger.createChild(LogComponent.API, 'admin_push');

	constructor(private env: Env) {
		this.broadcastService = new BroadcastService(env);
		this.telegramApi = new TelegramApiService(env);
		this.errorLogger = new ErrorLogger(env.DB);
	}

	/**
	 * 處理手動推播請求
	 */
	async handlePushRequest(request: ManualPushRequest): Promise<PushResult> {
		const pushId = `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const startTime = Date.now();

		this.logger.info('start', `開始手動推播`, {
			pushId,
			request: {
				...request,
				dryRun: request.dryRun || false,
			},
		});

		try {
			// 取得要推播的貼文
			const posts = await this.getPostsToPush(request);

			if (posts.length === 0) {
				this.logger.info('no_posts', '沒有找到需要推播的貼文', { pushId, request });

				return {
					pushId,
					dryRun: request.dryRun || false,
					postsProcessed: 0,
					targetUsers: 0,
					messagesSent: 0,
					messagesFailed: 0,
					duration: Date.now() - startTime,
					details: { posts: [] },
				};
			}

			// 取得目標用戶
			const targetUsers = await this.getTargetUsers(request);

			if (targetUsers.length === 0) {
				this.logger.warn('no_users', '沒有找到目標用戶', { pushId, request });

				return {
					pushId,
					dryRun: request.dryRun || false,
					postsProcessed: posts.length,
					targetUsers: 0,
					messagesSent: 0,
					messagesFailed: 0,
					duration: Date.now() - startTime,
					details: {
						posts: posts.map((post) => ({
							postId: post.id,
							title: post.title,
							targetUsers: 0,
							successCount: 0,
							failureCount: 0,
						})),
					},
				};
			}

			// 執行推播（或乾跑）
			const result = await this.executePush(pushId, posts, targetUsers, request);

			// 如果是乾跑模式，產生詳細預覽資訊
			if (request.dryRun) {
				result.details.executionPlan = await this.generateExecutionPlan(posts, targetUsers, request);
				result.details.warnings = await this.generateWarnings(posts, targetUsers, request);
			}

			this.logger.info('complete', '手動推播完成', {
				pushId,
				result: {
					postsProcessed: result.postsProcessed,
					targetUsers: result.targetUsers,
					messagesSent: result.messagesSent,
					messagesFailed: result.messagesFailed,
					duration: result.duration,
				},
			});

			return result;
		} catch (error) {
			const standardError = await handleError(
				error,
				{
					operation: 'admin_manual_push',
					entityId: pushId,
				},
				this.errorLogger
			);

			this.logger.error('failed', '手動推播失敗', { pushId, request }, error);

			return {
				pushId,
				dryRun: request.dryRun || false,
				postsProcessed: 0,
				targetUsers: 0,
				messagesSent: 0,
				messagesFailed: 0,
				duration: Date.now() - startTime,
				details: { posts: [] },
				errors: [standardError.message],
			};
		}
	}

	/**
	 * 取得要推播的貼文
	 */
	private async getPostsToPush(request: ManualPushRequest): Promise<
		Array<{
			id: number;
			title: string;
			content: string;
			url: string;
			published: number;
			filtersJson: string | null;
			publishedTs: number | null;
		}>
	> {
		let query: string;
		let params: any[];

		if (request.postId) {
			// 推播指定貼文
			query = `
        SELECT id, title, content, url, published, filters_json, published_ts
        FROM posts 
        WHERE id = ?
      `;
			params = [request.postId];
		} else {
			// 推播未發布的貼文（或強制推播）
			if (request.force) {
				query = `
          SELECT id, title, content, url, published, filters_json, published_ts
          FROM posts 
          ORDER BY publish_ts ASC
          LIMIT 100
        `;
				params = [];
			} else {
				query = `
          SELECT id, title, content, url, published, filters_json, published_ts
          FROM posts 
          WHERE published = 0 
          ORDER BY publish_ts ASC
          LIMIT 100
        `;
				params = [];
			}
		}

		const result = await this.env.DB.prepare(query)
			.bind(...params)
			.all();

		return (result.results || []).map((row) => ({
			id: row.id as number,
			title: row.title as string,
			content: row.content as string,
			url: row.url as string,
			published: row.published as number,
			filtersJson: row.filters_json as string | null,
			publishedTs: row.published_ts as number | null,
		}));
	}

	/**
	 * 取得目標用戶
	 */
	private async getTargetUsers(request: ManualPushRequest): Promise<
		Array<{
			chatId: number;
			username: string | null;
			status: string;
		}>
	> {
		let query: string;
		let params: any[];

		if (request.chatIds && request.chatIds.length > 0) {
			// 指定特定用戶
			const placeholders = request.chatIds.map(() => '?').join(',');
			query = `
        SELECT chat_id, username, status
        FROM subscriptions 
        WHERE chat_id IN (${placeholders}) AND status = 'active'
      `;
			params = request.chatIds;
		} else {
			// 所有啟用的訂閱
			query = `
        SELECT chat_id, username, status
        FROM subscriptions 
        WHERE status = 'active'
      `;
			params = [];
		}

		const result = await this.env.DB.prepare(query)
			.bind(...params)
			.all();

		return (result.results || []).map((row) => ({
			chatId: row.chat_id as number,
			username: row.username as string | null,
			status: row.status as string,
		}));
	}

	/**
	 * 執行推播
	 */
	private async executePush(
		pushId: string,
		posts: Array<{ id: number; title: string; content: string; url: string; filtersJson: string | null }>,
		targetUsers: Array<{ chatId: number; username: string | null }>,
		request: ManualPushRequest
	): Promise<PushResult> {
		const startTime = Date.now();
		let totalSent = 0;
		let totalFailed = 0;
		const postResults: PushResult['details']['posts'] = [];

		for (const post of posts) {
			this.logger.info('processing_post', `處理貼文推播`, {
				pushId,
				postId: post.id,
				title: post.title,
			});

			try {
				// 套用篩選條件
				const filteredUsers = await this.applyFilters(post, targetUsers, request.filterOverride);

				let successCount = 0;
				let failureCount = 0;

				if (request.dryRun) {
					// 乾跑模式：只模擬，不實際發送
					successCount = filteredUsers.length;
					this.logger.info('dry_run_simulation', `乾跑模式模擬推播`, {
						pushId,
						postId: post.id,
						simulatedUsers: filteredUsers.length,
					});

					// 為乾跑模式生成詳細預覽資訊
					const messagePreview = this.generateMessagePreview(post);
					const userPreview = filteredUsers.slice(0, 5); // 只顯示前5個用戶作為預覽

					postResults.push({
						postId: post.id,
						title: post.title,
						targetUsers: filteredUsers.length,
						successCount,
						failureCount,
						messagePreview,
						userPreview,
					});
				} else {
					// 實際推播
					for (const user of filteredUsers) {
						try {
							// 格式化訊息
							const messageText = this.generateMessagePreview(post);

							// 發送訊息
							await this.telegramApi.sendMessage(user.chatId.toString(), messageText);

							// 記錄投遞成功
							await this.createDeliveryRecord(user.chatId, post.id, 'sent');

							successCount++;
						} catch (error) {
							this.logger.warn('send_failed', `推播給用戶失敗`, {
								pushId,
								postId: post.id,
								chatId: user.chatId,
								error: error,
							});

							// 記錄投遞失敗
							await this.createDeliveryRecord(user.chatId, post.id, 'failed', error);

							failureCount++;
						}

						// 避免觸發速率限制
						await this.delay(50);
					}

					postResults.push({
						postId: post.id,
						title: post.title,
						targetUsers: filteredUsers.length,
						successCount,
						failureCount,
					});

					// 如果完全成功，標記貼文為已發布
					if (failureCount === 0 && successCount > 0) {
						await this.markPostAsPublished(post.id);
					}
				}

				totalSent += successCount;
				totalFailed += failureCount;

				postResults.push({
					postId: post.id,
					title: post.title,
					targetUsers: filteredUsers.length,
					successCount,
					failureCount,
				});
			} catch (error) {
				this.logger.error(
					'post_processing_failed',
					`貼文處理失敗`,
					{
						pushId,
						postId: post.id,
						title: post.title,
					},
					error
				);

				totalFailed++;

				postResults.push({
					postId: post.id,
					title: post.title,
					targetUsers: 0,
					successCount: 0,
					failureCount: 1,
				});
			}
		}

		return {
			pushId,
			dryRun: request.dryRun || false,
			postsProcessed: posts.length,
			targetUsers: targetUsers.length,
			messagesSent: totalSent,
			messagesFailed: totalFailed,
			duration: Date.now() - startTime,
			details: { posts: postResults },
		};
	}

	/**
	 * 生成訊息預覽（供乾跑模式和實際發送使用）
	 */
	private generateMessagePreview(post: { title: string; content: string; url: string }): string {
		return `<b>${post.title}</b>\n\n${post.content}\n\n🔗 <a href="${post.url}">查看完整內容</a>`;
	}

	/**
	 * 生成執行計劃（僅供乾跑模式使用）
	 */
	private async generateExecutionPlan(
		posts: Array<{ id: number; title: string; filtersJson: string | null }>,
		targetUsers: Array<{ chatId: number; username: string | null }>,
		request: ManualPushRequest
	): Promise<NonNullable<PushResult['details']['executionPlan']>> {
		const steps = [];
		let totalFiltered = 0;

		// 步驟1：貼文準備
		steps.push({
			step: '1. 貼文準備',
			description: `準備推播 ${posts.length} 篇貼文`,
			affectedCount: posts.length,
		});

		// 步驟2：用戶篩選
		for (const post of posts) {
			const filteredUsers = await this.applyFilters(post, targetUsers, request.filterOverride);
			totalFiltered += filteredUsers.length;
		}

		steps.push({
			step: '2. 用戶篩選',
			description: `從 ${targetUsers.length} 個訂閱用戶中篩選出符合條件的用戶`,
			affectedCount: totalFiltered,
		});

		// 步驟3：訊息發送
		steps.push({
			step: '3. 訊息發送',
			description: `發送訊息給篩選後的用戶`,
			affectedCount: totalFiltered,
		});

		// 步驟4：狀態更新
		if (!request.dryRun) {
			steps.push({
				step: '4. 狀態更新',
				description: `更新貼文發布狀態和投遞記錄`,
				affectedCount: posts.length,
			});
		}

		// 篩選條件描述
		let filterCriteria = '無特殊篩選條件';
		if (request.chatIds && request.chatIds.length > 0) {
			filterCriteria = `指定 ${request.chatIds.length} 個聊天 ID`;
		} else if (request.filterOverride?.usernames) {
			filterCriteria = `指定用戶名：${request.filterOverride.usernames.join(', ')}`;
		} else {
			// 檢查貼文中是否有篩選條件
			const hasFilters = posts.some((p) => {
				if (!p.filtersJson) return false;
				try {
					const filters = JSON.parse(p.filtersJson);
					return filters.usernames && filters.usernames.length > 0;
				} catch {
					return false;
				}
			});
			if (hasFilters) {
				filterCriteria = '依據貼文內的篩選條件';
			}
		}

		// 預估執行時間（每個用戶約50ms + 網路延遲）
		const estimatedDuration = Math.ceil(totalFiltered * 0.05 + posts.length * 0.1);

		return {
			steps,
			filterStats: {
				totalSubscriptions: targetUsers.length,
				activeSubscriptions: targetUsers.length,
				filteredUsers: totalFiltered,
				filterCriteria,
			},
			estimatedDuration,
		};
	}

	/**
	 * 生成潛在問題警告（僅供乾跑模式使用）
	 */
	private async generateWarnings(
		posts: Array<{ id: number; title: string; content: string; url: string; filtersJson: string | null }>,
		targetUsers: Array<{ chatId: number; username: string | null }>,
		request: ManualPushRequest
	): Promise<string[]> {
		const warnings = [];

		// 檢查1：無目標用戶
		if (targetUsers.length === 0) {
			warnings.push('⚠️ 沒有找到任何活躍的訂閱用戶');
		}

		// 檢查2：大量推播警告
		if (targetUsers.length > 1000) {
			warnings.push(`⚠️ 目標用戶數量較多（${targetUsers.length} 人），推播可能需要較長時間`);
		}

		// 檢查3：篩選條件問題
		for (const post of posts) {
			if (post.filtersJson) {
				try {
					const filters = JSON.parse(post.filtersJson);
					if (filters.usernames && Array.isArray(filters.usernames)) {
						const filteredUsers = await this.applyFilters(post, targetUsers, request.filterOverride);
						if (filteredUsers.length === 0) {
							warnings.push(`⚠️ 貼文「${post.title}」的篩選條件過於嚴格，沒有符合條件的用戶`);
						}
					}
				} catch {
					warnings.push(`⚠️ 貼文「${post.title}」的篩選條件 JSON 格式無效`);
				}
			}
		}

		// 檢查4：內容長度警告
		for (const post of posts) {
			const messageText = this.generateMessagePreview(post);
			if (messageText.length > 4096) {
				warnings.push(`⚠️ 貼文「${post.title}」的訊息長度超過 Telegram 限制（4096 字符），可能會被截斷`);
			}
		}

		// 檢查5：URL 有效性
		for (const post of posts) {
			try {
				new URL(post.url);
			} catch {
				warnings.push(`⚠️ 貼文「${post.title}」的 URL 格式可能無效：${post.url}`);
			}
		}

		return warnings;
	}

	/**
	 * 套用篩選條件
	 */
	private async applyFilters(
		post: { id: number; filtersJson: string | null },
		users: Array<{ chatId: number; username: string | null }>,
		filterOverride?: { usernames?: string[] }
	): Promise<Array<{ chatId: number; username: string | null }>> {
		// 使用覆蓋篩選條件或貼文本身的篩選條件
		let targetUsernames: string[] | null = null;

		if (filterOverride?.usernames) {
			targetUsernames = filterOverride.usernames;
		} else if (post.filtersJson) {
			try {
				const filters = JSON.parse(post.filtersJson);
				targetUsernames = filters.usernames || null;
			} catch (error) {
				this.logger.warn('filter_parse_error', `篩選條件解析失敗`, {
					postId: post.id,
					filtersJson: post.filtersJson,
				});
			}
		}

		// 如果沒有指定用戶名篩選，返回所有用戶
		if (!targetUsernames || targetUsernames.length === 0) {
			return users;
		}

		// 篩選指定用戶名的用戶
		const targetUsernameSet = new Set(targetUsernames.map((u) => u.toLowerCase()));

		return users.filter((user) => {
			if (!user.username) return false;
			return targetUsernameSet.has(user.username.toLowerCase());
		});
	}

	/**
	 * 標記貼文為已發布
	 */
	private async markPostAsPublished(postId: number): Promise<void> {
		const now = Date.now();

		await this.env.DB.prepare(
			`
      UPDATE posts 
      SET 
        published = 1,
        published_ts = ?,
        updated_ts = ?
      WHERE id = ?
    `
		)
			.bind(now, now, postId)
			.run();
	}

	/**
	 * 延遲執行
	 */
	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * 建立投遞記錄
	 */
	private async createDeliveryRecord(chatId: number, postId: number, status: 'sent' | 'failed', error?: any): Promise<void> {
		const now = Date.now();

		try {
			const errorJson = error
				? JSON.stringify({
						message: error.message || String(error),
						code: error.code || error.error_code,
						timestamp: now,
				  })
				: null;

			await this.env.DB.prepare(
				`
        INSERT INTO deliveries (
          post_id, chat_id, status, created_ts, updated_ts,
          sent_ts, error, retry_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
			)
				.bind(postId, chatId, status, now, now, status === 'sent' ? now : null, errorJson, 0)
				.run();
		} catch (dbError) {
			this.logger.error(
				'delivery_record_failed',
				'建立投遞記錄失敗',
				{
					chatId,
					postId,
					status,
				},
				dbError
			);
		}
	}
}

/**
 * POST /admin/push 端點處理器
 */
export async function handleAdminPush(c: Context<{ Bindings: Env }>): Promise<Response> {
	const logger_local = logger.createChild(LogComponent.API, 'admin_push');
	const startTime = Date.now();

	try {
		// 解析請求
		const request = await c.req.json<ManualPushRequest>();

		logger_local.info('request', '收到管理員推播請求', {
			request: {
				postId: request.postId,
				chatIds: request.chatIds?.length || 0,
				dryRun: request.dryRun || false,
				force: request.force || false,
			},
		});

		// 驗證請求
		const validation = validatePushRequest(request);
		if (!validation.valid) {
			logger_local.warn('validation_failed', '請求驗證失敗', {
				errors: validation.errors,
			});

			return c.json(
				{
					success: false,
					error: 'VALIDATION_ERROR',
					message: '請求參數驗證失敗',
					details: validation.errors,
				},
				400
			);
		}

		// 執行推播
		const pushService = new AdminPushService(c.env);
		const result = await pushService.handlePushRequest(request);

		const duration = Date.now() - startTime;

		// 記錄 API 日誌
		logger.logApiRequest('admin_push', 'POST', '/admin/push', 200, duration, {
			postId: request.postId,
			dryRun: request.dryRun,
			postsProcessed: result.postsProcessed,
			messagesSent: result.messagesSent,
		});

		return c.json({
			success: true,
			data: result,
		});
	} catch (error) {
		const duration = Date.now() - startTime;

		logger_local.error('handler_error', '管理員推播處理失敗', {}, error);

		// 記錄 API 錯誤日誌
		logger.logApiRequest('admin_push', 'POST', '/admin/push', 500, duration, { error: error });

		return c.json(
			{
				success: false,
				error: 'INTERNAL_ERROR',
				message: '內部伺服器錯誤',
			},
			500
		);
	}
}

/**
 * 驗證推播請求
 */
function validatePushRequest(request: ManualPushRequest): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// 驗證 postId
	if (request.postId !== undefined && (!Number.isInteger(request.postId) || request.postId <= 0)) {
		errors.push('postId 必須是正整數');
	}

	// 驗證 chatIds
	if (request.chatIds !== undefined) {
		if (!Array.isArray(request.chatIds)) {
			errors.push('chatIds 必須是陣列');
		} else {
			for (const chatId of request.chatIds) {
				if (!Number.isInteger(chatId) || chatId <= 0) {
					errors.push('chatIds 中的所有值必須是正整數');
					break;
				}
			}
		}
	}

	// 驗證 dryRun
	if (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') {
		errors.push('dryRun 必須是布林值');
	}

	// 驗證 force
	if (request.force !== undefined && typeof request.force !== 'boolean') {
		errors.push('force 必須是布林值');
	}

	// 驗證 filterOverride
	if (request.filterOverride !== undefined) {
		if (typeof request.filterOverride !== 'object' || request.filterOverride === null) {
			errors.push('filterOverride 必須是物件');
		} else if (request.filterOverride.usernames !== undefined) {
			if (!Array.isArray(request.filterOverride.usernames)) {
				errors.push('filterOverride.usernames 必須是陣列');
			} else {
				for (const username of request.filterOverride.usernames) {
					if (typeof username !== 'string') {
						errors.push('filterOverride.usernames 中的所有值必須是字串');
						break;
					}
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
