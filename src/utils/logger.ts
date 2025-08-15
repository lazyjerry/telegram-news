/**
 * 結構化 JSON 日誌系統
 *
 * 提供統一、結構化的日誌記錄功能，支援：
 * - 多層級日誌（debug, info, warn, error, critical）
 * - 元件和操作分類
 * - 效能監控（執行時間）
 * - 結構化 JSON 格式輸出
 * - 可配置的日誌級別過濾
 */

/**
 * 日誌級別枚舉
 */
export enum LogLevel {
	DEBUG = 'debug',
	INFO = 'info',
	WARN = 'warn',
	ERROR = 'error',
	CRITICAL = 'critical',
}

/**
 * 系統元件枚舉
 */
export enum LogComponent {
	API = 'api',
	WEBHOOK = 'webhook',
	CRON = 'cron',
	DATABASE = 'database',
	TELEGRAM = 'telegram',
	BROADCAST = 'broadcast',
	SUBSCRIPTION = 'subscription',
	AUTH = 'auth',
	RETRY = 'retry',
	VALIDATOR = 'validator',
	SYSTEM = 'system',
}

/**
 * 結構化日誌項目介面
 */
export interface LogEntry {
	/** 時間戳 (ISO 8601 格式) */
	timestamp: string;
	/** 日誌級別 */
	level: LogLevel;
	/** 系統元件 */
	component: LogComponent;
	/** 具體操作名稱 */
	operation: string;
	/** 日誌訊息 */
	message: string;
	/** 相關數據 */
	data?: Record<string, any>;
	/** 執行耗時（毫秒） */
	duration?: number;
	/** HTTP 回應狀態碼 */
	httpStatus?: number;
	/** 錯誤資訊 */
	error?: {
		name?: string;
		message?: string;
		stack?: string;
		code?: string | number;
	};
	/** 追蹤 ID */
	traceId?: string;
	/** 用戶 ID 或聊天 ID */
	userId?: string | number;
	/** 請求 ID */
	requestId?: string;
}

/**
 * 日誌配置介面
 */
export interface LoggerConfig {
	/** 最低日誌級別 */
	minLevel: LogLevel;
	/** 是否包含敏感資料 */
	includeSensitiveData: boolean;
	/** 是否美化 JSON 輸出 */
	prettyPrint: boolean;
	/** 自定義格式化函數 */
	formatter?: (entry: LogEntry) => string;
}

/**
 * 預設日誌配置
 */
const DEFAULT_CONFIG: LoggerConfig = {
	minLevel: LogLevel.INFO,
	includeSensitiveData: false,
	prettyPrint: false,
};

/**
 * 日誌級別權重（用於過濾）
 */
const LOG_LEVEL_WEIGHTS: Record<LogLevel, number> = {
	[LogLevel.DEBUG]: 0,
	[LogLevel.INFO]: 1,
	[LogLevel.WARN]: 2,
	[LogLevel.ERROR]: 3,
	[LogLevel.CRITICAL]: 4,
};

/**
 * 結構化日誌記錄器
 */
export class StructuredLogger {
	private config: LoggerConfig;
	private startTimes: Map<string, number> = new Map();

	constructor(config: Partial<LoggerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * 記錄 debug 級別日誌
	 */
	debug(component: LogComponent, operation: string, message: string, data?: Record<string, any>): void {
		this.log(LogLevel.DEBUG, component, operation, message, data);
	}

	/**
	 * 記錄 info 級別日誌
	 */
	info(component: LogComponent, operation: string, message: string, data?: Record<string, any>): void {
		this.log(LogLevel.INFO, component, operation, message, data);
	}

	/**
	 * 記錄 warn 級別日誌
	 */
	warn(component: LogComponent, operation: string, message: string, data?: Record<string, any>): void {
		this.log(LogLevel.WARN, component, operation, message, data);
	}

	/**
	 * 記錄 error 級別日誌
	 */
	error(component: LogComponent, operation: string, message: string, data?: Record<string, any>, error?: any): void {
		const errorInfo = error ? this.extractErrorInfo(error) : undefined;
		this.log(LogLevel.ERROR, component, operation, message, data, { error: errorInfo });
	}

	/**
	 * 記錄 critical 級別日誌
	 */
	critical(component: LogComponent, operation: string, message: string, data?: Record<string, any>, error?: any): void {
		const errorInfo = error ? this.extractErrorInfo(error) : undefined;
		this.log(LogLevel.CRITICAL, component, operation, message, data, { error: errorInfo });
	}

	/**
	 * 開始時間測量
	 * @param operationId 操作唯一標識
	 */
	startTimer(operationId: string): void {
		this.startTimes.set(operationId, Date.now());
	}

	/**
	 * 結束時間測量並記錄日誌
	 * @param operationId 操作唯一標識
	 * @param level 日誌級別
	 * @param component 系統元件
	 * @param operation 操作名稱
	 * @param message 日誌訊息
	 * @param data 相關資料
	 */
	endTimer(
		operationId: string,
		level: LogLevel,
		component: LogComponent,
		operation: string,
		message: string,
		data?: Record<string, any>
	): void {
		const startTime = this.startTimes.get(operationId);
		if (startTime) {
			const duration = Date.now() - startTime;
			this.startTimes.delete(operationId);

			this.log(level, component, operation, message, data, { duration });
		} else {
			this.warn(LogComponent.SYSTEM, 'timer', `找不到操作 ${operationId} 的開始時間`);
			this.log(level, component, operation, message, data);
		}
	}

	/**
	 * 記錄 API 請求
	 */
	logApiRequest(operation: string, method: string, path: string, statusCode: number, duration: number, data?: Record<string, any>): void {
		this.log(
			statusCode >= 400 ? LogLevel.ERROR : LogLevel.INFO,
			LogComponent.API,
			operation,
			`${method} ${path}`,
			{
				method,
				path,
				statusCode,
				...data,
			},
			{ duration, httpStatus: statusCode }
		);
	}

	/**
	 * 記錄 Telegram Webhook 處理
	 */
	logWebhookEvent(
		operation: string,
		updateType: string,
		chatId?: number,
		userId?: number,
		duration?: number,
		data?: Record<string, any>
	): void {
		this.log(
			LogLevel.INFO,
			LogComponent.WEBHOOK,
			operation,
			`處理 Telegram ${updateType} 事件`,
			{
				updateType,
				chatId,
				userId,
				...data,
			},
			{ duration, userId: userId || chatId }
		);
	}

	/**
	 * 記錄資料庫操作
	 */
	logDatabaseOperation(
		operation: string,
		table: string,
		action: string,
		duration: number,
		rowsAffected?: number,
		data?: Record<string, any>
	): void {
		this.log(
			LogLevel.DEBUG,
			LogComponent.DATABASE,
			operation,
			`${action} ${table}`,
			{
				table,
				action,
				rowsAffected,
				...data,
			},
			{ duration }
		);
	}

	/**
	 * 記錄投遞操作
	 */
	logDelivery(
		operation: string,
		chatId: number,
		postId: number,
		status: 'sent' | 'failed',
		duration: number,
		error?: any,
		data?: Record<string, any>
	): void {
		const level = status === 'sent' ? LogLevel.INFO : LogLevel.ERROR;
		const errorInfo = error ? this.extractErrorInfo(error) : undefined;

		this.log(
			level,
			LogComponent.BROADCAST,
			operation,
			`投遞${status === 'sent' ? '成功' : '失敗'} - Chat: ${chatId}, Post: ${postId}`,
			{
				chatId,
				postId,
				status,
				...data,
			},
			{ duration, userId: chatId, error: errorInfo }
		);
	}

	/**
	 * 核心日誌記錄方法
	 */
	private log(
		level: LogLevel,
		component: LogComponent,
		operation: string,
		message: string,
		data?: Record<string, any>,
		meta?: {
			duration?: number;
			httpStatus?: number;
			error?: any;
			userId?: string | number;
			requestId?: string;
			traceId?: string;
		}
	): void {
		// 檢查日誌級別過濾
		if (LOG_LEVEL_WEIGHTS[level] < LOG_LEVEL_WEIGHTS[this.config.minLevel]) {
			return;
		}

		// 構建日誌項目
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			component,
			operation,
			message,
			...(data && { data: this.sanitizeData(data) }),
			...(meta?.duration !== undefined && { duration: meta.duration }),
			...(meta?.httpStatus && { httpStatus: meta.httpStatus }),
			...(meta?.error && { error: meta.error }),
			...(meta?.userId && { userId: meta.userId }),
			...(meta?.requestId && { requestId: meta.requestId }),
			...(meta?.traceId && { traceId: meta.traceId }),
		};

		// 輸出日誌
		this.output(entry);
	}

	/**
	 * 清理敏感資料
	 */
	private sanitizeData(data: Record<string, any>): Record<string, any> {
		if (this.config.includeSensitiveData) {
			return data;
		}

		const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization', 'cookie', 'session', 'api_key', 'bot_token'];

		const sanitized = { ...data };

		for (const [key, value] of Object.entries(sanitized)) {
			const lowerKey = key.toLowerCase();

			if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
				sanitized[key] = '[REDACTED]';
			} else if (typeof value === 'object' && value !== null) {
				sanitized[key] = this.sanitizeData(value);
			}
		}

		return sanitized;
	}

	/**
	 * 提取錯誤資訊
	 */
	private extractErrorInfo(error: any): LogEntry['error'] {
		if (!error) return undefined;

		return {
			name: error.name || error.constructor?.name,
			message: error.message || String(error),
			stack: error.stack,
			code: error.code || error.error_code || error.status,
		};
	}

	/**
	 * 輸出日誌
	 */
	private output(entry: LogEntry): void {
		let output: string;

		if (this.config.formatter) {
			output = this.config.formatter(entry);
		} else if (this.config.prettyPrint) {
			output = JSON.stringify(entry, null, 2);
		} else {
			output = JSON.stringify(entry);
		}

		// 根據級別選擇輸出方式
		switch (entry.level) {
			case LogLevel.CRITICAL:
			case LogLevel.ERROR:
				console.error(output);
				break;
			case LogLevel.WARN:
				console.warn(output);
				break;
			case LogLevel.DEBUG:
				console.debug ? console.debug(output) : console.log(output);
				break;
			default:
				console.log(output);
		}
	}

	/**
	 * 更新日誌配置
	 */
	updateConfig(config: Partial<LoggerConfig>): void {
		this.config = { ...this.config, ...config };
	}

	/**
	 * 建立子記錄器（帶有預設元件和操作前綴）
	 */
	createChild(component: LogComponent, operationPrefix?: string): ChildLogger {
		return new ChildLogger(this, component, operationPrefix);
	}
}

/**
 * 子記錄器（預設元件的便利類別）
 */
export class ChildLogger {
	constructor(private parent: StructuredLogger, private component: LogComponent, private operationPrefix?: string) {}

	private formatOperation(operation: string): string {
		return this.operationPrefix ? `${this.operationPrefix}.${operation}` : operation;
	}

	debug(operation: string, message: string, data?: Record<string, any>): void {
		this.parent.debug(this.component, this.formatOperation(operation), message, data);
	}

	info(operation: string, message: string, data?: Record<string, any>): void {
		this.parent.info(this.component, this.formatOperation(operation), message, data);
	}

	warn(operation: string, message: string, data?: Record<string, any>): void {
		this.parent.warn(this.component, this.formatOperation(operation), message, data);
	}

	error(operation: string, message: string, data?: Record<string, any>, error?: any): void {
		this.parent.error(this.component, this.formatOperation(operation), message, data, error);
	}

	critical(operation: string, message: string, data?: Record<string, any>, error?: any): void {
		this.parent.critical(this.component, this.formatOperation(operation), message, data, error);
	}
}

/**
 * 全域日誌實例
 * 提供應用程式統一的日誌記錄入口
 */
export const logger = new StructuredLogger({
	minLevel: LogLevel.INFO,
	includeSensitiveData: false,
	prettyPrint: false,
});

/**
 * 設定日誌級別（根據環境）
 */
export function configureLogger(env: 'development' | 'production' | 'test'): void {
	switch (env) {
		case 'development':
			logger.updateConfig({
				minLevel: LogLevel.DEBUG,
				prettyPrint: true,
			});
			break;
		case 'test':
			logger.updateConfig({
				minLevel: LogLevel.WARN,
				prettyPrint: false,
			});
			break;
		case 'production':
		default:
			logger.updateConfig({
				minLevel: LogLevel.INFO,
				prettyPrint: false,
				includeSensitiveData: false,
			});
			break;
	}
}

/**
 * 效能測量裝飾器
 * 用於自動測量函數執行時間
 */
export function measurePerformance(component: LogComponent, operation: string) {
	return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
		const method = descriptor.value;

		descriptor.value = async function (...args: any[]) {
			const operationId = `${component}.${operation}.${Date.now()}`;

			logger.startTimer(operationId);

			try {
				const result = await method.apply(this, args);

				logger.endTimer(operationId, LogLevel.DEBUG, component, operation, `完成 ${operation} 操作`, { success: true });

				return result;
			} catch (error) {
				logger.endTimer(operationId, LogLevel.ERROR, component, operation, `操作 ${operation} 失敗`, { success: false });

				throw error;
			}
		};

		return descriptor;
	};
}
