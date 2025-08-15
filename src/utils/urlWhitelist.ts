/**
 * URL 白名單管理工具
 *
 * 提供 URL 域名白名單驗證功能，包括：
 * - 白名單域名檢查
 * - 萬用字元匹配支援
 * - 黑名單域名過濾
 * - 緊急覆蓋機制
 */

import { logger, LogComponent } from './logger';

/**
 * URL 白名單配置介面
 */
export interface WhitelistConfig {
	/** 允許的域名列表（支援萬用字元） */
	allowedDomains: string[];
	/** 黑名單域名列表 */
	blockedDomains: string[];
	/** 是否啟用白名單檢查 */
	enabled: boolean;
	/** 管理員緊急覆蓋 token */
	emergencyOverrideToken?: string;
}

/**
 * URL 驗證結果介面
 */
export interface ValidationResult {
	/** 是否允許此 URL */
	allowed: boolean;
	/** 域名 */
	domain: string;
	/** 拒絕原因（如果被拒絕） */
	reason?: 'domain_not_whitelisted' | 'domain_blacklisted' | 'invalid_url' | 'malicious_domain';
	/** 匹配的規則（如果允許） */
	matchedRule?: string;
}

/**
 * 預設白名單配置
 */
const DEFAULT_CONFIG: WhitelistConfig = {
	enabled: false, // 預設關閉，避免影響現有功能
	allowedDomains: [
		// 主要新聞媒體
		'*.cna.com.tw',
		'*.udn.com',
		'*.chinatimes.com',
		'*.ltn.com.tw',
		'*.appledaily.com',
		'*.tvbs.com.tw',
		'*.ctv.com.tw',
		'*.pts.org.tw',
		'*.rti.org.tw',

		// 國際新聞媒體
		'*.reuters.com',
		'*.bbc.com',
		'*.cnn.com',
		'*.ap.org',

		// 政府官方網站
		'*.gov.tw',
		'*.president.gov.tw',

		// 學術機構
		'*.edu.tw',
		'*.ac.tw',
	],
	blockedDomains: [
		// 已知的惡意或垃圾網站
		'example-spam.com',
		'fake-news.org',
	],
};

/**
 * URL 白名單驗證器
 */
export class UrlWhitelistValidator {
	private config: WhitelistConfig;
	private logger = logger.createChild(LogComponent.VALIDATOR, 'url_whitelist');

	constructor(config?: Partial<WhitelistConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };

		this.logger.info('initialized', 'URL 白名單驗證器已初始化', {
			enabled: this.config.enabled,
			allowedDomainsCount: this.config.allowedDomains.length,
			blockedDomainsCount: this.config.blockedDomains.length,
		});
	}

	/**
	 * 驗證 URL 是否允許
	 */
	async validateUrl(url: string, emergencyOverride?: string): Promise<ValidationResult> {
		// 如果未啟用白名單，一律允許
		if (!this.config.enabled) {
			return { allowed: true, domain: this.extractDomain(url) };
		}

		// 檢查緊急覆蓋
		if (emergencyOverride && this.config.emergencyOverrideToken && emergencyOverride === this.config.emergencyOverrideToken) {
			this.logger.warn('emergency_override', 'URL 驗證被緊急覆蓋', { url });
			return { allowed: true, domain: this.extractDomain(url) };
		}

		try {
			// 解析 URL
			const parsedUrl = new URL(url);
			const domain = parsedUrl.hostname.toLowerCase();

			// 先檢查黑名單
			if (this.isDomainBlocked(domain)) {
				this.logger.warn('blocked_domain', 'URL 域名在黑名單中', { url, domain });
				return {
					allowed: false,
					domain,
					reason: 'domain_blacklisted',
				};
			}

			// 檢查白名單
			const matchedRule = this.findMatchingWhitelistRule(domain);
			if (matchedRule) {
				this.logger.info('allowed_domain', 'URL 域名通過白名單驗證', {
					url,
					domain,
					matchedRule,
				});
				return {
					allowed: true,
					domain,
					matchedRule,
				};
			}

			// 不在白名單中
			this.logger.warn('not_whitelisted', 'URL 域名不在白名單中', { url, domain });
			return {
				allowed: false,
				domain,
				reason: 'domain_not_whitelisted',
			};
		} catch (error) {
			this.logger.error('invalid_url', 'URL 格式無效', { url }, error);
			return {
				allowed: false,
				domain: '',
				reason: 'invalid_url',
			};
		}
	}

	/**
	 * 批量驗證 URL
	 */
	async validateUrls(urls: string[], emergencyOverride?: string): Promise<ValidationResult[]> {
		const results = [];

		for (const url of urls) {
			const result = await this.validateUrl(url, emergencyOverride);
			results.push(result);
		}

		return results;
	}

	/**
	 * 新增允許的域名到白名單
	 */
	addToWhitelist(domain: string): void {
		if (!this.config.allowedDomains.includes(domain)) {
			this.config.allowedDomains.push(domain);
			this.logger.info('whitelist_updated', '域名已新增到白名單', { domain });
		}
	}

	/**
	 * 從白名單移除域名
	 */
	removeFromWhitelist(domain: string): void {
		const index = this.config.allowedDomains.indexOf(domain);
		if (index > -1) {
			this.config.allowedDomains.splice(index, 1);
			this.logger.info('whitelist_updated', '域名已從白名單移除', { domain });
		}
	}

	/**
	 * 新增域名到黑名單
	 */
	addToBlacklist(domain: string): void {
		if (!this.config.blockedDomains.includes(domain)) {
			this.config.blockedDomains.push(domain);
			this.logger.info('blacklist_updated', '域名已新增到黑名單', { domain });
		}
	}

	/**
	 * 從黑名單移除域名
	 */
	removeFromBlacklist(domain: string): void {
		const index = this.config.blockedDomains.indexOf(domain);
		if (index > -1) {
			this.config.blockedDomains.splice(index, 1);
			this.logger.info('blacklist_updated', '域名已從黑名單移除', { domain });
		}
	}

	/**
	 * 取得當前白名單配置
	 */
	getConfig(): WhitelistConfig {
		return { ...this.config };
	}

	/**
	 * 更新配置
	 */
	updateConfig(newConfig: Partial<WhitelistConfig>): void {
		this.config = { ...this.config, ...newConfig };
		this.logger.info('config_updated', 'URL 白名單配置已更新', {
			enabled: this.config.enabled,
			allowedDomainsCount: this.config.allowedDomains.length,
			blockedDomainsCount: this.config.blockedDomains.length,
		});
	}

	/**
	 * 提取 URL 中的域名
	 */
	private extractDomain(url: string): string {
		try {
			return new URL(url).hostname.toLowerCase();
		} catch {
			return '';
		}
	}

	/**
	 * 檢查域名是否在黑名單中
	 */
	private isDomainBlocked(domain: string): boolean {
		return this.config.blockedDomains.some((blockedDomain) => {
			return this.matchesDomainPattern(domain, blockedDomain);
		});
	}

	/**
	 * 尋找匹配的白名單規則
	 */
	private findMatchingWhitelistRule(domain: string): string | null {
		for (const allowedDomain of this.config.allowedDomains) {
			if (this.matchesDomainPattern(domain, allowedDomain)) {
				return allowedDomain;
			}
		}
		return null;
	}

	/**
	 * 檢查域名是否匹配模式（支援萬用字元）
	 */
	private matchesDomainPattern(domain: string, pattern: string): boolean {
		// 精確匹配
		if (domain === pattern) {
			return true;
		}

		// 萬用字元匹配
		if (pattern.startsWith('*.')) {
			const baseDomain = pattern.substring(2); // 移除 '*.'
			return domain.endsWith('.' + baseDomain) || domain === baseDomain;
		}

		// 子域名匹配
		if (pattern.startsWith('.')) {
			return domain.endsWith(pattern);
		}

		return false;
	}
}

/**
 * 全域 URL 白名單驗證器實例
 *
 * 可通過環境變數配置：
 * - URL_WHITELIST_ENABLED: 是否啟用白名單
 * - URL_WHITELIST_EMERGENCY_TOKEN: 緊急覆蓋 token
 */
export let urlWhitelistValidator: UrlWhitelistValidator;

/**
 * 初始化 URL 白名單驗證器
 */
export function initializeUrlWhitelist(config?: Partial<WhitelistConfig>): UrlWhitelistValidator {
	urlWhitelistValidator = new UrlWhitelistValidator(config);
	return urlWhitelistValidator;
}

/**
 * 取得全域 URL 白名單驗證器實例
 */
export function getUrlWhitelistValidator(): UrlWhitelistValidator {
	if (!urlWhitelistValidator) {
		urlWhitelistValidator = new UrlWhitelistValidator();
	}
	return urlWhitelistValidator;
}

/**
 * URL 白名單中間件（用於 API 端點）
 */
export function createUrlValidationMiddleware(config?: Partial<WhitelistConfig>) {
	return async function urlValidationMiddleware(url: string, emergencyOverride?: string): Promise<ValidationResult> {
		const validator = config ? new UrlWhitelistValidator(config) : getUrlWhitelistValidator();
		return await validator.validateUrl(url, emergencyOverride);
	};
}
