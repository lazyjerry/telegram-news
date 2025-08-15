/**
 * 外部 I/O 重試包裝工具模組
 *
 * 提供自動重試機制，支援指數退避策略
 * 主要用於處理 Telegram API 和資料庫連線的暫時性錯誤
 */

/**
 * 重試配置選項
 */
export interface RetryOptions {
	/** 最大重試次數，預設 3 次 */
	maxRetries?: number;
	/** 初始延遲時間（毫秒），預設 1000ms */
	initialDelay?: number;
	/** 退避倍數，預設 2 */
	backoffMultiplier?: number;
	/** 最大延遲時間（毫秒），預設 30000ms (30秒) */
	maxDelay?: number;
	/** 是否應該重試的判斷函數 */
	shouldRetry?: (error: any) => boolean;
	/** 重試前的回調函數 */
	onRetry?: (error: any, attempt: number) => void;
}

/**
 * 重試結果介面
 */
export interface RetryResult<T> {
	/** 執行結果 */
	result: T;
	/** 實際重試次數 */
	attempts: number;
	/** 總執行時間（毫秒） */
	totalTime: number;
	/** 是否成功 */
	success: boolean;
}

/**
 * 預設重試選項
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	initialDelay: 1000,
	backoffMultiplier: 2,
	maxDelay: 30000,
	shouldRetry: (error: any) => {
		// 預設重試策略：網路錯誤和 5xx 錯誤重試
		if (error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT') {
			return true;
		}

		// HTTP 狀態碼重試策略
		const status = error?.status || error?.response?.status;
		if (status >= 500 && status < 600) {
			return true; // 5xx 伺服器錯誤
		}
		if (status === 429) {
			return true; // 速率限制
		}
		if (status === 408) {
			return true; // 請求逾時
		}

		return false;
	},
	onRetry: (error: any, attempt: number) => {
		console.warn(`重試第 ${attempt} 次，錯誤：${error?.message || error}`);
	},
};

/**
 * 延遲執行
 * @param ms 延遲時間（毫秒）
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 計算下次重試的延遲時間（指數退避）
 * @param attempt 當前重試次數（從 1 開始）
 * @param options 重試選項
 * @returns 延遲時間（毫秒）
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
	const exponentialDelay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);

	// 加入隨機抖動（jitter）避免雷鳴群體效應
	const jitter = Math.random() * 0.1 * exponentialDelay;
	const delayWithJitter = exponentialDelay + jitter;

	// 限制最大延遲時間
	return Math.min(delayWithJitter, options.maxDelay);
}

/**
 * 帶重試的非同步函數包裝器
 *
 * @param fn 要執行的非同步函數
 * @param options 重試選項
 * @returns 包裝後的重試結果
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetch('https://api.telegram.org/bot.../sendMessage', { ... }),
 *   {
 *     maxRetries: 3,
 *     shouldRetry: (error) => error.status === 429 || error.status >= 500
 *   }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
	const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
	const startTime = Date.now();
	let lastError: any;

	for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
		try {
			const result = await fn();
			const totalTime = Date.now() - startTime;

			return {
				result,
				attempts: attempt,
				totalTime,
				success: true,
			};
		} catch (error) {
			lastError = error;

			// 如果已達最大重試次數，直接拋出錯誤
			if (attempt > opts.maxRetries) {
				break;
			}

			// 檢查是否應該重試
			if (!opts.shouldRetry(error)) {
				console.log(`錯誤不適合重試，直接失敗: ${(error as any)?.message || error}`);
				break;
			}

			// 執行重試前回調
			opts.onRetry(error, attempt);

			// 計算延遲時間並等待
			const delayTime = calculateDelay(attempt, opts);
			console.log(`等待 ${delayTime}ms 後進行第 ${attempt} 次重試`);
			await delay(delayTime);
		}
	}

	const totalTime = Date.now() - startTime;

	// 所有重試都失敗了，拋出最後一個錯誤
	throw {
		...lastError,
		retryInfo: {
			attempts: opts.maxRetries + 1,
			totalTime,
			success: false,
		},
	};
}

/**
 * Telegram API 專用重試包裝器
 * 針對 Telegram API 的特殊錯誤處理
 */
export async function withTelegramRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
	return withRetry(fn, {
		maxRetries: 3,
		initialDelay: 1000,
		shouldRetry: (error: any) => {
			const errorCode = error?.error_code || error?.status;

			// Telegram API 特殊處理
			if (errorCode === 429) {
				// 速率限制，檢查 retry_after
				const retryAfter = error?.parameters?.retry_after;
				if (retryAfter && retryAfter > 60) {
					// 如果要等待超過 60 秒，直接失敗
					console.warn(`速率限制等待時間過長 (${retryAfter}s)，放棄重試`);
					return false;
				}
				return true;
			}

			// 伺服器錯誤重試
			if (errorCode >= 500) {
				return true;
			}

			// 網路錯誤重試
			if (error?.code === 'NETWORK_ERROR' || error?.code === 'TIMEOUT') {
				return true;
			}

			return false;
		},
		onRetry: (error: any, attempt: number) => {
			const retryAfter = error?.parameters?.retry_after;
			if (retryAfter) {
				console.warn(`Telegram API 速率限制，等待 ${retryAfter} 秒後重試 (嘗試 ${attempt})`);
			} else {
				console.warn(`Telegram API 錯誤，進行第 ${attempt} 次重試: ${error?.description || error?.message || error}`);
			}
		},
		...options,
	});
}

/**
 * 資料庫操作專用重試包裝器
 * 針對 D1 資料庫的特殊錯誤處理
 */
export async function withDatabaseRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<RetryResult<T>> {
	return withRetry(fn, {
		maxRetries: 3,
		initialDelay: 500,
		shouldRetry: (error: any) => {
			// D1 資料庫暫時性錯誤
			const errorMessage = error?.message?.toLowerCase() || '';

			if (
				errorMessage.includes('timeout') ||
				errorMessage.includes('connection') ||
				errorMessage.includes('busy') ||
				errorMessage.includes('locked')
			) {
				return true;
			}

			return false;
		},
		onRetry: (error: any, attempt: number) => {
			console.warn(`資料庫操作失敗，進行第 ${attempt} 次重試: ${error?.message || error}`);
		},
		...options,
	});
}
