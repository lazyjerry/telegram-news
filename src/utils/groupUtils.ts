/**
 * Telegram 新聞推播系統 - 群組管理工具
 * 繁體中文說明：處理群組管理員權限驗證與群組專用功能
 */

import type { Env } from '../types';

/**
 * Telegram 群組成員類型
 */
export type ChatMemberStatus = 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked';

/**
 * Telegram 群組成員資訊
 */
export interface ChatMember {
	user: {
		id: number;
		is_bot: boolean;
		first_name: string;
		last_name?: string;
		username?: string;
	};
	status: ChatMemberStatus;
	custom_title?: string;
	is_anonymous?: boolean;
	can_manage_chat?: boolean;
	can_change_info?: boolean;
	can_post_messages?: boolean;
	can_edit_messages?: boolean;
	can_delete_messages?: boolean;
	can_manage_video_chats?: boolean;
	can_restrict_members?: boolean;
	can_promote_members?: boolean;
	can_manage_topics?: boolean;
	can_invite_users?: boolean;
	can_pin_messages?: boolean;
}

/**
 * 管理員權限快取項目
 */
interface AdminCacheItem {
	isAdmin: boolean;
	timestamp: number;
	expireTime: number;
}

/**
 * 群組工具類別
 */
export class GroupUtils {
	private env: Env;
	private adminCache: Map<string, AdminCacheItem> = new Map();
	private readonly CACHE_EXPIRE_TIME = 5 * 60 * 1000; // 5 分鐘

	constructor(env: Env) {
		this.env = env;
	}

	/**
	 * 檢查用戶在群組中的管理員權限
	 * @param chatId 群組 ID
	 * @param userId 用戶 ID
	 * @returns Promise<boolean> 是否為管理員
	 */
	async checkAdminPermission(chatId: number, userId: number): Promise<boolean> {
		try {
			const cacheKey = `${chatId}:${userId}`;
			const cached = this.adminCache.get(cacheKey);

			// 檢查快取
			if (cached && Date.now() < cached.expireTime) {
				console.log(`使用快取的管理員權限，用戶 ${userId} 在群組 ${chatId}: ${cached.isAdmin}`);
				return cached.isAdmin;
			}

			console.log(`檢查用戶 ${userId} 在群組 ${chatId} 的管理員權限`);

			// 呼叫 Telegram API
			const botToken = this.env.TELEGRAM_BOT_TOKEN;
			const url = `https://api.telegram.org/bot${botToken}/getChatMember`;

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chat_id: chatId,
					user_id: userId,
				}),
			});

			const result = (await response.json()) as any;

			if (!result.ok) {
				console.warn(`getChatMember API 呼叫失敗:`, result);
				// API 失敗時預設為非管理員，避免安全風險
				this.setCacheItem(cacheKey, false);
				return false;
			}

			const member = result.result as ChatMember;
			const isAdmin = member.status === 'creator' || member.status === 'administrator';

			console.log(`用戶 ${userId} 在群組 ${chatId} 的狀態: ${member.status}, 管理員權限: ${isAdmin}`);

			// 快取結果
			this.setCacheItem(cacheKey, isAdmin);

			return isAdmin;
		} catch (error) {
			console.error(`檢查管理員權限時發生錯誤:`, error);
			// 發生錯誤時預設為非管理員
			return false;
		}
	}

	/**
	 * 檢查機器人在群組中的權限
	 * @param chatId 群組 ID
	 * @returns Promise<{canSendMessages: boolean, canDeleteMessages: boolean}> 機器人權限
	 */
	async checkBotPermissions(chatId: number): Promise<{
		canSendMessages: boolean;
		canDeleteMessages: boolean;
		canPinMessages: boolean;
	}> {
		try {
			console.log(`檢查機器人在群組 ${chatId} 的權限`);

			const botToken = this.env.TELEGRAM_BOT_TOKEN;
			const url = `https://api.telegram.org/bot${botToken}/getMe`;

			// 先取得機器人資訊
			const botInfoResponse = await fetch(url);
			const botInfo = (await botInfoResponse.json()) as any;

			if (!botInfo.ok) {
				console.error('無法取得機器人資訊');
				return { canSendMessages: false, canDeleteMessages: false, canPinMessages: false };
			}

			const botId = botInfo.result.id;

			// 檢查機器人在群組中的狀態
			const memberUrl = `https://api.telegram.org/bot${botToken}/getChatMember`;
			const memberResponse = await fetch(memberUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chat_id: chatId,
					user_id: botId,
				}),
			});

			const memberResult = (await memberResponse.json()) as any;

			if (!memberResult.ok) {
				console.warn(`檢查機器人群組狀態失敗:`, memberResult);
				return { canSendMessages: false, canDeleteMessages: false, canPinMessages: false };
			}

			const member = memberResult.result as ChatMember;

			return {
				canSendMessages: member.status === 'administrator' || member.status === 'member',
				canDeleteMessages: member.can_delete_messages || false,
				canPinMessages: member.can_pin_messages || false,
			};
		} catch (error) {
			console.error(`檢查機器人權限時發生錯誤:`, error);
			return { canSendMessages: false, canDeleteMessages: false, canPinMessages: false };
		}
	}

	/**
	 * 建立權限錯誤訊息
	 * @param requiredPermission 需要的權限描述
	 * @returns string 錯誤訊息
	 */
	createPermissionErrorMessage(requiredPermission: string = '管理員權限'): string {
		return (
			`⚠️ 權限不足\n\n` + `此功能需要 ${requiredPermission}\n` + `請聯絡群組管理員協助處理\n\n` + `💡 只有群組創建者或管理員可以使用此功能`
		);
	}

	/**
	 * 建立機器人權限錯誤訊息
	 * @param missingPermission 缺少的權限
	 * @returns string 錯誤訊息
	 */
	createBotPermissionErrorMessage(missingPermission: string): string {
		return (
			`🤖 機器人權限不足\n\n` +
			`機器人缺少「${missingPermission}」權限\n` +
			`請群組管理員為機器人授予相應權限\n\n` +
			`⚙️ 設定方式：\n` +
			`1. 點擊機器人用戶名\n` +
			`2. 選擇「編輯權限」\n` +
			`3. 開啟所需權限`
		);
	}

	/**
	 * 檢查是否為群組環境
	 * @param chatType 聊天類型
	 * @returns boolean 是否為群組
	 */
	isGroupChat(chatType: string): boolean {
		return ['group', 'supergroup'].includes(chatType);
	}

	/**
	 * 檢查是否為私人聊天
	 * @param chatType 聊天類型
	 * @returns boolean 是否為私人聊天
	 */
	isPrivateChat(chatType: string): boolean {
		return chatType === 'private';
	}

	/**
	 * 設定快取項目
	 * @param key 快取鍵
	 * @param isAdmin 是否為管理員
	 */
	private setCacheItem(key: string, isAdmin: boolean): void {
		const now = Date.now();
		this.adminCache.set(key, {
			isAdmin,
			timestamp: now,
			expireTime: now + this.CACHE_EXPIRE_TIME,
		});

		// 定期清理過期的快取項目
		this.cleanupExpiredCache();
	}

	/**
	 * 清理過期的快取項目
	 */
	private cleanupExpiredCache(): void {
		const now = Date.now();
		let cleanedCount = 0;

		for (const [key, item] of this.adminCache.entries()) {
			if (now >= item.expireTime) {
				this.adminCache.delete(key);
				cleanedCount++;
			}
		}

		if (cleanedCount > 0) {
			console.log(`清理了 ${cleanedCount} 個過期的權限快取項目`);
		}
	}

	/**
	 * 取得快取統計資訊
	 * @returns {activeItems: number, totalItems: number} 快取統計
	 */
	getCacheStats(): { activeItems: number; totalItems: number } {
		const now = Date.now();
		let activeItems = 0;
		const totalItems = this.adminCache.size;

		for (const item of this.adminCache.values()) {
			if (now < item.expireTime) {
				activeItems++;
			}
		}

		return { activeItems, totalItems };
	}
}
