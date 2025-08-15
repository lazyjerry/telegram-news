/**
 * Telegram 新聞推播系統 - 速率限制器
 * 繁體中文說明：實作 Token Bucket 算法，控制 Telegram API 呼叫速率
 */

/**
 * Token Bucket 速率限制器
 * 用於控制 API 呼叫頻率，避免超過 Telegram 的速率限制
 */
export class RateLimiter {
	private tokens: number;
	private lastRefill: number;
	private readonly capacity: number;
	private readonly refillRate: number; // 每秒補充的 token 數量

	/**
	 * 建立速率限制器
	 * @param capacity 桶的容量（最大 token 數）
	 * @param refillRate 每秒補充的 token 數量
	 */
	constructor(capacity: number, refillRate: number) {
		this.capacity = capacity;
		this.refillRate = refillRate;
		this.tokens = capacity;
		this.lastRefill = Date.now();
	}

	/**
	 * 嘗試消費指定數量的 token
	 * @param tokens 要消費的 token 數量
	 * @returns Promise<boolean> 是否成功消費
	 */
	async consume(tokens: number = 1): Promise<boolean> {
		this.refillTokens();

		if (this.tokens >= tokens) {
			this.tokens -= tokens;
			return true;
		}

		return false;
	}

	/**
	 * 等待直到有足夠的 token 可用
	 * @param tokens 需要的 token 數量
	 * @returns Promise<void>
	 */
	async waitForTokens(tokens: number = 1): Promise<void> {
		while (!(await this.consume(tokens))) {
			// 計算需要等待的時間
			const tokensNeeded = tokens - this.tokens;
			const waitTime = Math.ceil((tokensNeeded / this.refillRate) * 1000);

			console.log(`速率限制中，等待 ${waitTime}ms 獲得 ${tokensNeeded} 個 token`);

			await new Promise((resolve) => setTimeout(resolve, Math.min(waitTime, 1000)));
		}
	}

	/**
	 * 補充 token
	 */
	private refillTokens(): void {
		const now = Date.now();
		const timePassed = (now - this.lastRefill) / 1000;
		const tokensToAdd = Math.floor(timePassed * this.refillRate);

		if (tokensToAdd > 0) {
			this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
			this.lastRefill = now;
		}
	}

	/**
	 * 取得當前可用的 token 數量
	 * @returns 可用 token 數量
	 */
	getAvailableTokens(): number {
		this.refillTokens();
		return this.tokens;
	}
}

/**
 * 全域速率限制器管理員
 * 管理不同類型的速率限制器
 */
export class RateLimiterManager {
	private globalLimiter: RateLimiter;
	private chatLimiters: Map<string, RateLimiter>;
	private readonly globalRate = 25; // 全域每秒 25 個請求
	private readonly chatRate = 1; // 每個聊天每秒 1 個請求

	constructor() {
		// 全域速率限制器：每秒 25 個 token，桶容量 30
		this.globalLimiter = new RateLimiter(30, this.globalRate);

		// 聊天級別的速率限制器 Map
		this.chatLimiters = new Map();
	}

	/**
	 * 為特定聊天獲取速率限制器
	 * @param chatId 聊天 ID
	 * @returns RateLimiter 該聊天的速率限制器
	 */
	private getChatLimiter(chatId: string): RateLimiter {
		if (!this.chatLimiters.has(chatId)) {
			// 每個聊天每秒 1 個 token，桶容量 2
			this.chatLimiters.set(chatId, new RateLimiter(2, this.chatRate));
		}
		return this.chatLimiters.get(chatId)!;
	}

	/**
	 * 等待直到可以向指定聊天發送訊息
	 * @param chatId 聊天 ID
	 * @returns Promise<void>
	 */
	async waitForSend(chatId: string): Promise<void> {
		console.log(`檢查聊天 ${chatId} 的發送速率限制`);

		// 先等待全域速率限制
		await this.globalLimiter.waitForTokens(1);

		// 再等待該聊天的速率限制
		const chatLimiter = this.getChatLimiter(chatId);
		await chatLimiter.waitForTokens(1);

		console.log(`聊天 ${chatId} 速率檢查通過，可以發送訊息`);
	}

	/**
	 * 清理長時間不活躍的聊天速率限制器，釋放記憶體
	 */
	cleanupInactiveLimiters(): void {
		// 保留最近 1000 個聊天的限制器，清理其他的
		if (this.chatLimiters.size > 1000) {
			const entries = Array.from(this.chatLimiters.entries());
			const toKeep = entries.slice(-500); // 保留最後 500 個

			this.chatLimiters.clear();
			toKeep.forEach(([chatId, limiter]) => {
				this.chatLimiters.set(chatId, limiter);
			});

			console.log(`清理速率限制器，保留 ${toKeep.length} 個活躍聊天`);
		}
	}

	/**
	 * 取得速率限制器統計資訊
	 * @returns 統計資訊物件
	 */
	getStats(): { globalTokens: number; activeChatLimiters: number } {
		return {
			globalTokens: this.globalLimiter.getAvailableTokens(),
			activeChatLimiters: this.chatLimiters.size,
		};
	}
}
