/**
 * 錯誤記錄系統
 *
 * 負責記錄和管理系統中的各種錯誤，包括：
 * - 投遞失敗的錯誤記錄（deliveries.error）
 * - 貼文處理的最後錯誤（posts.last_error）
 * - 系統級別的錯誤日誌
 */

/**
 * 錯誤類型枚舉
 */
export enum ErrorType {
	/** 網路連線錯誤 */
	NETWORK_ERROR = 'NETWORK_ERROR',
	/** Telegram API 錯誤 */
	TELEGRAM_API_ERROR = 'TELEGRAM_API_ERROR',
	/** 資料庫錯誤 */
	DATABASE_ERROR = 'DATABASE_ERROR',
	/** 驗證錯誤 */
	VALIDATION_ERROR = 'VALIDATION_ERROR',
	/** 速率限制錯誤 */
	RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
	/** 用戶封鎖機器人 */
	USER_BLOCKED_BOT = 'USER_BLOCKED_BOT',
	/** 聊天不存在或機器人被移除 */
	CHAT_NOT_FOUND = 'CHAT_NOT_FOUND',
	/** 系統內部錯誤 */
	INTERNAL_ERROR = 'INTERNAL_ERROR',
	/** 外部服務錯誤 */
	EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}

/**
 * 錯誤嚴重性級別
 */
export enum ErrorSeverity {
	/** 低：可自動恢復的錯誤 */
	LOW = 'LOW',
	/** 中：需要監控但不影響主要功能 */
	MEDIUM = 'MEDIUM',
	/** 高：影響用戶體驗但系統可持續運行 */
	HIGH = 'HIGH',
	/** 嚴重：系統功能受到重大影響 */
	CRITICAL = 'CRITICAL',
}

/**
 * 標準化錯誤資訊介面
 */
export interface StandardError {
	/** 錯誤類型 */
	type: ErrorType;
	/** 錯誤訊息 */
	message: string;
	/** 錯誤碼（如果有） */
	code?: string | number;
	/** 錯誤嚴重性 */
	severity: ErrorSeverity;
	/** 發生時間戳 */
	timestamp: number;
	/** 額外的錯誤詳情 */
	details?: any;
	/** 錯誤堆疊 */
	stack?: string;
	/** 是否可重試 */
	retryable: boolean;
	/** 相關的實體 ID（如 chat_id, post_id） */
	entityId?: string | number;
}

/**
 * 投遞錯誤記錄介面
 */
export interface DeliveryError extends StandardError {
	/** 投遞 ID */
	deliveryId: number;
	/** 聊天 ID */
	chatId: number;
	/** 貼文 ID */
	postId: number;
	/** HTTP 狀態碼 */
	httpStatus?: number;
	/** Telegram 錯誤描述 */
	telegramDescription?: string;
}

/**
 * 貼文錯誤記錄介面
 */
export interface PostError extends StandardError {
	/** 貼文 ID */
	postId: number;
	/** 影響的用戶數 */
	affectedUsers?: number;
}

/**
 * 錯誤分析和分類工具
 */
export class ErrorAnalyzer {
	/**
	 * 分析並標準化任意錯誤物件
	 * @param error 原始錯誤物件
	 * @param context 錯誤發生的上下文資訊
	 * @returns 標準化的錯誤資訊
	 */
	static analyzeError(error: any, context: { operation?: string; entityId?: string | number } = {}): StandardError {
		const timestamp = Date.now();
		const baseError: Partial<StandardError> = {
			timestamp,
			entityId: context.entityId,
			details: {
				operation: context.operation,
				originalError: error,
			},
		};

		// Telegram API 錯誤分析
		if (error?.error_code || error?.description) {
			return this.analyzeTelegramError(error, baseError);
		}

		// HTTP 錯誤分析
		if (error?.status || error?.response?.status) {
			return this.analyzeHttpError(error, baseError);
		}

		// 網路錯誤分析
		if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('fetch')) {
			return {
				...baseError,
				type: ErrorType.NETWORK_ERROR,
				message: '網路連線失敗',
				severity: ErrorSeverity.MEDIUM,
				retryable: true,
				code: error.code,
			} as StandardError;
		}

		// 資料庫錯誤分析
		if (error?.message?.includes('D1_ERROR') || error?.message?.toLowerCase().includes('database')) {
			return {
				...baseError,
				type: ErrorType.DATABASE_ERROR,
				message: `資料庫操作失敗: ${error.message}`,
				severity: ErrorSeverity.HIGH,
				retryable: true,
				stack: error.stack,
			} as StandardError;
		}

		// 通用錯誤
		return {
			...baseError,
			type: ErrorType.INTERNAL_ERROR,
			message: error?.message || String(error) || '未知錯誤',
			severity: ErrorSeverity.MEDIUM,
			retryable: false,
			stack: error?.stack,
		} as StandardError;
	}

	/**
	 * 分析 Telegram API 錯誤
	 */
	private static analyzeTelegramError(error: any, baseError: Partial<StandardError>): StandardError {
		const errorCode = error.error_code;
		const description = error.description || '';

		let type = ErrorType.TELEGRAM_API_ERROR;
		let severity = ErrorSeverity.MEDIUM;
		let retryable = false;

		// 根據錯誤碼分類
		switch (errorCode) {
			case 400:
				severity = ErrorSeverity.LOW;
				if (description.includes('chat not found')) {
					type = ErrorType.CHAT_NOT_FOUND;
				}
				break;

			case 403:
				severity = ErrorSeverity.MEDIUM;
				if (description.includes('blocked by the user')) {
					type = ErrorType.USER_BLOCKED_BOT;
				}
				break;

			case 429:
				type = ErrorType.RATE_LIMIT_ERROR;
				severity = ErrorSeverity.HIGH;
				retryable = true;
				break;

			case 500:
			case 502:
			case 503:
				severity = ErrorSeverity.HIGH;
				retryable = true;
				break;

			default:
				retryable = errorCode >= 500;
		}

		return {
			...baseError,
			type,
			message: `Telegram API 錯誤 [${errorCode}]: ${description}`,
			code: errorCode,
			severity,
			retryable,
			details: {
				...baseError.details,
				telegramDescription: description,
				parameters: error.parameters,
			},
		} as StandardError;
	}

	/**
	 * 分析 HTTP 錯誤
	 */
	private static analyzeHttpError(error: any, baseError: Partial<StandardError>): StandardError {
		const status = error.status || error.response?.status;
		const statusText = error.statusText || error.response?.statusText;

		return {
			...baseError,
			type: ErrorType.EXTERNAL_SERVICE_ERROR,
			message: `HTTP 錯誤 [${status}]: ${statusText}`,
			code: status,
			severity: status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
			retryable: status >= 500,
			details: {
				...baseError.details,
				httpStatus: status,
				headers: error.response?.headers,
			},
		} as StandardError;
	}
}

/**
 * 錯誤記錄器類別
 */
export class ErrorLogger {
	constructor(private db: D1Database) {}

	/**
	 * 記錄投遞錯誤到資料庫
	 * @param deliveryId 投遞記錄 ID
	 * @param error 標準化錯誤資訊
	 */
	async logDeliveryError(deliveryId: number, error: StandardError): Promise<void> {
		try {
			const errorJson = JSON.stringify({
				type: error.type,
				message: error.message,
				code: error.code,
				severity: error.severity,
				timestamp: error.timestamp,
				retryable: error.retryable,
				details: error.details,
			});

			await this.db
				.prepare(
					`
        UPDATE deliveries 
        SET 
          error = ?,
          updated_ts = ?
        WHERE id = ?
      `
				)
				.bind(errorJson, Date.now(), deliveryId)
				.run();

			console.warn(`投遞錯誤已記錄 [ID: ${deliveryId}]: ${error.message}`);
		} catch (dbError) {
			console.error('記錄投遞錯誤失敗:', dbError);
			// 即使資料庫記錄失敗，也要確保錯誤資訊不會遺失
			console.error('原始投遞錯誤:', error);
		}
	}

	/**
	 * 記錄貼文處理錯誤到資料庫
	 * @param postId 貼文 ID
	 * @param error 標準化錯誤資訊
	 */
	async logPostError(postId: number, error: StandardError): Promise<void> {
		try {
			const errorJson = JSON.stringify({
				type: error.type,
				message: error.message,
				code: error.code,
				severity: error.severity,
				timestamp: error.timestamp,
				retryable: error.retryable,
				details: error.details,
			});

			await this.db
				.prepare(
					`
        UPDATE posts 
        SET 
          last_error = ?,
          updated_ts = ?
        WHERE id = ?
      `
				)
				.bind(errorJson, Date.now(), postId)
				.run();

			console.warn(`貼文錯誤已記錄 [Post ID: ${postId}]: ${error.message}`);
		} catch (dbError) {
			console.error('記錄貼文錯誤失敗:', dbError);
			// 即使資料庫記錄失敗，也要確保錯誤資訊不會遺失
			console.error('原始貼文錯誤:', error);
		}
	}

	/**
	 * 取得投遞的錯誤歷史
	 * @param deliveryId 投遞 ID
	 * @returns 錯誤資訊（如果有）
	 */
	async getDeliveryError(deliveryId: number): Promise<StandardError | null> {
		try {
			const result = await this.db
				.prepare(
					`
        SELECT error FROM deliveries WHERE id = ?
      `
				)
				.bind(deliveryId)
				.first();

			if (result?.error) {
				return JSON.parse(result.error as string) as StandardError;
			}

			return null;
		} catch (error) {
			console.error('查詢投遞錯誤失敗:', error);
			return null;
		}
	}

	/**
	 * 取得貼文的最後錯誤
	 * @param postId 貼文 ID
	 * @returns 錯誤資訊（如果有）
	 */
	async getPostError(postId: number): Promise<StandardError | null> {
		try {
			const result = await this.db
				.prepare(
					`
        SELECT last_error FROM posts WHERE id = ?
      `
				)
				.bind(postId)
				.first();

			if (result?.last_error) {
				return JSON.parse(result.last_error as string) as StandardError;
			}

			return null;
		} catch (error) {
			console.error('查詢貼文錯誤失敗:', error);
			return null;
		}
	}

	/**
	 * 清除成功處理後的錯誤記錄
	 * @param deliveryId 投遞 ID
	 */
	async clearDeliveryError(deliveryId: number): Promise<void> {
		try {
			await this.db
				.prepare(
					`
        UPDATE deliveries 
        SET error = NULL, updated_ts = ?
        WHERE id = ?
      `
				)
				.bind(Date.now(), deliveryId)
				.run();

			console.log(`已清除投遞錯誤記錄 [ID: ${deliveryId}]`);
		} catch (error) {
			console.error('清除投遞錯誤記錄失敗:', error);
		}
	}

	/**
	 * 清除成功處理後的貼文錯誤記錄
	 * @param postId 貼文 ID
	 */
	async clearPostError(postId: number): Promise<void> {
		try {
			await this.db
				.prepare(
					`
        UPDATE posts 
        SET last_error = NULL, updated_ts = ?
        WHERE id = ?
      `
				)
				.bind(Date.now(), postId)
				.run();

			console.log(`已清除貼文錯誤記錄 [Post ID: ${postId}]`);
		} catch (error) {
			console.error('清除貼文錯誤記錄失敗:', error);
		}
	}

	/**
	 * 獲取錯誤統計資訊
	 * @param timeRange 時間範圍（毫秒）
	 * @returns 錯誤統計
	 */
	async getErrorStats(timeRange: number = 24 * 60 * 60 * 1000): Promise<{
		totalErrors: number;
		errorsByType: Record<string, number>;
		errorsBySeverity: Record<string, number>;
	}> {
		const since = Date.now() - timeRange;

		try {
			// 統計投遞錯誤
			const deliveryErrors = await this.db
				.prepare(
					`
        SELECT error FROM deliveries 
        WHERE error IS NOT NULL AND updated_ts >= ?
      `
				)
				.bind(since)
				.all();

			// 統計貼文錯誤
			const postErrors = await this.db
				.prepare(
					`
        SELECT last_error FROM posts 
        WHERE last_error IS NOT NULL AND updated_ts >= ?
      `
				)
				.bind(since)
				.all();

			const allErrors: StandardError[] = [];

			// 解析投遞錯誤
			for (const row of deliveryErrors.results || []) {
				try {
					const error = JSON.parse((row as any).error);
					allErrors.push(error);
				} catch (e) {
					console.warn('解析投遞錯誤記錄失敗:', e);
				}
			}

			// 解析貼文錯誤
			for (const row of postErrors.results || []) {
				try {
					const error = JSON.parse((row as any).last_error);
					allErrors.push(error);
				} catch (e) {
					console.warn('解析貼文錯誤記錄失敗:', e);
				}
			}

			// 統計錯誤類型
			const errorsByType: Record<string, number> = {};
			const errorsBySeverity: Record<string, number> = {};

			for (const error of allErrors) {
				errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
				errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
			}

			return {
				totalErrors: allErrors.length,
				errorsByType,
				errorsBySeverity,
			};
		} catch (error) {
			console.error('獲取錯誤統計失敗:', error);
			return {
				totalErrors: 0,
				errorsByType: {},
				errorsBySeverity: {},
			};
		}
	}
}

/**
 * 錯誤處理輔助函數
 * 統一的錯誤處理入口點
 */
export async function handleError(
	error: any,
	context: {
		operation: string;
		entityId?: string | number;
		deliveryId?: number;
		postId?: number;
	},
	errorLogger?: ErrorLogger
): Promise<StandardError> {
	// 分析和標準化錯誤
	const standardError = ErrorAnalyzer.analyzeError(error, context);

	// 記錄到資料庫（如果有提供 errorLogger）
	if (errorLogger) {
		try {
			if (context.deliveryId) {
				await errorLogger.logDeliveryError(context.deliveryId, standardError);
			}

			if (context.postId) {
				await errorLogger.logPostError(context.postId, standardError);
			}
		} catch (logError) {
			console.error('錯誤記錄失敗:', logError);
		}
	}

	// 根據嚴重性決定日誌級別
	switch (standardError.severity) {
		case ErrorSeverity.CRITICAL:
			console.error(`🚨 嚴重錯誤 [${context.operation}]:`, standardError.message);
			break;
		case ErrorSeverity.HIGH:
			console.error(`❗ 高級錯誤 [${context.operation}]:`, standardError.message);
			break;
		case ErrorSeverity.MEDIUM:
			console.warn(`⚠️  中級錯誤 [${context.operation}]:`, standardError.message);
			break;
		case ErrorSeverity.LOW:
			console.log(`ℹ️  低級錯誤 [${context.operation}]:`, standardError.message);
			break;
	}

	return standardError;
}
