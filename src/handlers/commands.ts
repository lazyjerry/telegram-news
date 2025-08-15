/**
 * Telegram 新聞推播系統 - 指令處理程式
 * 繁體中文說明：處理 Telegram Bot 的各種指令和關鍵字互動
 */

import type { Env } from '../types';
import { TelegramApiService, type InlineKeyboardMarkup, type InlineKeyboardButton } from '../services/telegramApi';
import { GroupUtils } from '../utils/groupUtils';

/**
 * 訊息類型枚舉
 */
export enum MessageType {
	TEXT_MESSAGE = 'text_message',
	CALLBACK_QUERY = 'callback_query',
	EDITED_MESSAGE = 'edited_message',
	UNSUPPORTED = 'unsupported',
}

/**
 * 解析後的訊息結構
 */
export interface ParsedMessage {
	type: MessageType;
	chatId: number;
	userId: number;
	chatType: string; // 聊天類型：'private', 'group', 'supergroup', 'channel'
	text?: string;
	messageId?: number;
	callbackData?: string;
	isGroup: boolean;
	isPrivate: boolean;
}

/**
 * 指令匹配結果
 */
export interface CommandMatch {
	command: string;
	args: string[];
	isCommand: boolean;
}

/**
 * 指令處理器類別
 * 負責處理所有 Telegram 指令和關鍵字互動
 */
export class CommandHandler {
	private env: Env;
	private telegramApi: TelegramApiService;
	private groupUtils: GroupUtils;

	constructor(env: Env) {
		this.env = env;
		this.telegramApi = new TelegramApiService(env);
		this.groupUtils = new GroupUtils(env);
	}

	/**
	 * 處理指令訊息
	 * @param message 解析後的訊息物件
	 * @param commandMatch 指令匹配結果
	 * @returns Promise<void>
	 */
	async handleCommand(message: ParsedMessage, commandMatch: CommandMatch): Promise<void> {
		console.log(`處理指令: ${commandMatch.command}`);

		try {
			switch (commandMatch.command) {
				case 'start':
					await this.handleStartCommand(message);
					break;

				case 'subscribe':
				case 'sub':
					await this.handleSubscribeCommand(message);
					break;

				case 'unsubscribe':
				case 'unsub':
					await this.handleUnsubscribeCommand(message);
					break;

				case 'status':
					await this.handleStatusCommand(message);
					break;

				case 'help':
					await this.handleHelpCommand(message);
					break;

				case 'confirm':
					await this.handleConfirmCommand(message, commandMatch.args);
					break;

				case 'groupsettings':
				case 'gsettings':
					await this.handleGroupSettingsCommand(message, commandMatch.args);
					break;

				case 'groupinfo':
				case 'ginfo':
					await this.handleGroupInfoCommand(message);
					break;

				default:
					await this.handleUnknownCommand(message, commandMatch.command);
					break;
			}
		} catch (error) {
			console.error(`指令 ${commandMatch.command} 處理失敗:`, error);
			await this.sendErrorMessage(message.chatId, '指令處理時發生錯誤，請稍後再試。');
		}
	}

	/**
	 * 處理按鈕回調查詢
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	async handleCallbackQuery(message: ParsedMessage): Promise<void> {
		console.log(`處理按鈕回調: ${message.callbackData}`);

		try {
			const callbackData = message.callbackData;

			if (!callbackData) {
				console.warn('按鈕回調缺少 data');
				return;
			}

			// 解析回調資料格式：action:param
			const [action, param] = callbackData.split(':');

			switch (action) {
				case 'subscribe':
					await this.handleSubscribeCommand(message);
					break;

				case 'unsubscribe':
					await this.handleUnsubscribeCommand(message);
					break;

				case 'status':
					await this.handleStatusCommand(message);
					break;

				case 'confirm':
					if (param) {
						await this.handleConfirmCommand(message, [param]);
					}
					break;

				case 'close_help':
					// 刪除幫助訊息
					await this.deleteMessage(message.chatId, message.messageId);
					break;

				case 'group_settings':
					// 處理群組設定按鈕
					await this.handleGroupSettingsCommand(message, []);
					break;

				case 'group_subs':
				case 'group_config':
				case 'group_status':
				case 'group_members':
					// 處理群組管理子選單
					await this.handleGroupManagementAction(message, action);
					break;

				case 'close_menu':
					// 關閉選單
					await this.deleteMessage(message.chatId, message.messageId);
					break;

				default:
					console.warn(`不支援的回調動作: ${action}`);
					break;
			}
		} catch (error) {
			console.error('按鈕回調處理失敗:', error);
			await this.sendErrorMessage(message.chatId, '按鈕操作失敗，請稍後再試。');
		}
	}

	/**
	 * 處理一般文字訊息（檢查關鍵字）
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	async handleText(message: ParsedMessage): Promise<void> {
		if (!message.text) return;

		const text = message.text.toLowerCase().trim();
		console.log(`處理文字訊息: ${text}`);

		// 關鍵字匹配
		if (this.containsKeyword(text, ['訂閱', '我要訂閱', '開始訂閱'])) {
			await this.handleSubscribeCommand(message);
		} else if (this.containsKeyword(text, ['退訂', '取消訂閱', '不要了'])) {
			await this.handleUnsubscribeCommand(message);
		} else if (this.containsKeyword(text, ['狀態', '我的狀態', '訂閱狀態'])) {
			await this.handleStatusCommand(message);
		} else if (this.containsKeyword(text, ['幫助', '說明', '怎麼用'])) {
			await this.handleHelpCommand(message);
		} else {
			// 對於不匹配的訊息，在群組中不回應，在私聊中提供簡單指引
			if (message.isPrivate) {
				await this.handleUnknownMessage(message);
			}
		}
	}

	/**
	 * 處理 /start 指令
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleStartCommand(message: ParsedMessage): Promise<void> {
		console.log(`處理 /start 指令，聊天 ID: ${message.chatId}`);

		try {
			// 檢查用戶訂閱狀態
			const subscriptionStatus = await this.checkSubscriptionStatus(message.chatId.toString());

			let welcomeMessage: string;
			let keyboard: InlineKeyboardMarkup | undefined;

			if (subscriptionStatus.subscribed) {
				// 已訂閱用戶的歡迎訊息
				welcomeMessage =
					`🎉 歡迎回來！\n\n` +
					`您已成功訂閱新聞推播服務。\n` +
					`訂閱狀態：${subscriptionStatus.confirmed ? '✅ 已確認' : '⏳ 待確認'}\n\n` +
					`📰 您將自動收到最新新聞推播\n` +
					`💡 可隨時輸入 /status 查看詳細狀態\n` +
					`❌ 如需退訂請輸入 /unsubscribe`;

				keyboard = {
					inline_keyboard: [
						[
							{ text: '📊 查看狀態', callback_data: 'status' },
							{ text: '❌ 退訂', callback_data: 'unsubscribe' },
						],
					],
				};
			} else {
				// 新用戶的歡迎訊息
				welcomeMessage =
					`👋 歡迎使用新聞推播機器人！\n\n` +
					`📰 本機器人提供以下功能：\n` +
					`• 自動推播最新新聞\n` +
					`• 即時新聞通知\n` +
					`• 個人化訂閱管理\n\n` +
					`🚀 立即訂閱開始使用：\n` +
					`點擊下方按鈕或輸入 /subscribe\n\n` +
					`❓ 需要幫助請輸入 /help`;

				keyboard = {
					inline_keyboard: [
						[
							{ text: '🔔 立即訂閱', callback_data: 'subscribe' },
							{ text: '❓ 說明', callback_data: 'help' },
						],
					],
				};
			}

			await this.telegramApi.sendInteractiveMessage(message.chatId, welcomeMessage, keyboard);
		} catch (error) {
			console.error('處理 /start 指令失敗:', error);
			await this.sendErrorMessage(message.chatId, '無法載入歡迎訊息，請稍後再試。');
		}
	}

	/**
	 * 處理 /subscribe 指令和「訂閱」關鍵字
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleSubscribeCommand(message: ParsedMessage): Promise<void> {
		console.log(`處理訂閱請求，聊天 ID: ${message.chatId}`);

		try {
			// 檢查現有訂閱狀態
			const subscriptionStatus = await this.checkSubscriptionStatus(message.chatId.toString());

			if (subscriptionStatus.subscribed && subscriptionStatus.confirmed) {
				// 已確認訂閱
				const message_text =
					`✅ 您已經訂閱了新聞推播服務！\n\n` +
					`📰 您將持續收到最新新聞推播\n` +
					`💡 輸入 /status 查看詳細狀態\n` +
					`❌ 如需退訂請輸入 /unsubscribe`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [
						[
							{ text: '📊 查看狀態', callback_data: 'status' },
							{ text: '❌ 退訂', callback_data: 'unsubscribe' },
						],
					],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
				return;
			}

			// 建立新訂閱或更新現有訂閱
			const subscriptionResult = await this.createSubscription(message.chatId.toString());

			if (subscriptionResult.success) {
				const confirmUrl = `https://${this.getWorkerDomain()}/subscriptions/confirm?token=${subscriptionResult.token}`;

				const message_text =
					`🔔 訂閱申請已送出！\n\n` +
					`⏳ 請點擊下方連結確認訂閱：\n` +
					`${confirmUrl}\n\n` +
					`⚠️ 確認連結將在 10 分鐘後過期\n` +
					`💡 您也可以複製上方連結在瀏覽器中開啟\n\n` +
					`❓ 需要幫助請輸入 /help`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [[{ text: '🔗 確認訂閱', url: confirmUrl }], [{ text: '📊 查看狀態', callback_data: 'status' }]],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
			} else {
				await this.sendErrorMessage(message.chatId, subscriptionResult.error || '訂閱建立失敗');
			}
		} catch (error) {
			console.error('處理訂閱指令失敗:', error);
			await this.sendErrorMessage(message.chatId, '無法處理訂閱請求，請稍後再試。');
		}
	}

	/**
	 * 處理 /unsubscribe 指令和「退訂」關鍵字
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleUnsubscribeCommand(message: ParsedMessage): Promise<void> {
		console.log(`處理退訂請求，聊天 ID: ${message.chatId}`);

		try {
			// 檢查訂閱狀態
			const subscriptionStatus = await this.checkSubscriptionStatus(message.chatId.toString());

			if (!subscriptionStatus.subscribed) {
				const message_text =
					`ℹ️ 您目前沒有訂閱新聞推播服務\n\n` + `🔔 如需訂閱請點擊下方按鈕或輸入 /subscribe\n` + `❓ 需要幫助請輸入 /help`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [[{ text: '🔔 立即訂閱', callback_data: 'subscribe' }]],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
				return;
			}

			// 執行退訂
			const unsubscribeResult = await this.deleteSubscription(message.chatId.toString());

			if (unsubscribeResult.success) {
				const message_text =
					`✅ 退訂成功！\n\n` + `📰 您已停止接收新聞推播\n` + `🔔 如需重新訂閱，隨時可以點擊下方按鈕\n\n` + `謝謝您的使用！`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [[{ text: '🔔 重新訂閱', callback_data: 'subscribe' }]],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
			} else {
				await this.sendErrorMessage(message.chatId, unsubscribeResult.error || '退訂處理失敗');
			}
		} catch (error) {
			console.error('處理退訂指令失敗:', error);
			await this.sendErrorMessage(message.chatId, '無法處理退訂請求，請稍後再試。');
		}
	}

	/**
	 * 處理 /status 指令和「狀態」關鍵字
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleStatusCommand(message: ParsedMessage): Promise<void> {
		console.log(`處理狀態查詢，聊天 ID: ${message.chatId}`);

		try {
			const subscriptionStatus = await this.getDetailedSubscriptionStatus(message.chatId.toString());

			if (!subscriptionStatus.subscribed) {
				const message_text = `📊 訂閱狀態查詢\n\n` + `❌ 目前未訂閱新聞推播服務\n\n` + `🔔 點擊下方按鈕開始訂閱`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [[{ text: '🔔 立即訂閱', callback_data: 'subscribe' }]],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
				return;
			}

			// 格式化訂閱時間
			const subscribeTime = subscriptionStatus.subscribe_ts
				? new Date(subscriptionStatus.subscribe_ts * 1000).toLocaleString('zh-TW', {
						timeZone: 'Asia/Taipei',
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
				  })
				: '未知';

			const confirmTime = subscriptionStatus.confirm_ts
				? new Date(subscriptionStatus.confirm_ts * 1000).toLocaleString('zh-TW', {
						timeZone: 'Asia/Taipei',
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
				  })
				: null;

			let statusEmoji = '⏳';
			let statusText = '待確認';

			if (subscriptionStatus.confirmed) {
				statusEmoji = '✅';
				statusText = '已確認';
			} else if (subscriptionStatus.token_expired) {
				statusEmoji = '⚠️';
				statusText = '確認連結已過期';
			}

			let message_text = `📊 您的訂閱狀態\n\n` + `狀態：${statusEmoji} ${statusText}\n` + `訂閱時間：${subscribeTime}\n`;

			if (confirmTime) {
				message_text += `確認時間：${confirmTime}\n`;
			}

			message_text += `\n💡 功能說明：\n` + `• 自動接收最新新聞推播\n` + `• 即時新聞通知提醒`;

			let keyboard: InlineKeyboardMarkup;

			if (!subscriptionStatus.confirmed) {
				keyboard = {
					inline_keyboard: [
						[
							{ text: '🔔 重新訂閱', callback_data: 'subscribe' },
							{ text: '❌ 取消訂閱', callback_data: 'unsubscribe' },
						],
					],
				};
			} else {
				keyboard = {
					inline_keyboard: [[{ text: '❌ 取消訂閱', callback_data: 'unsubscribe' }]],
				};
			}

			await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
		} catch (error) {
			console.error('處理狀態查詢失敗:', error);
			await this.sendErrorMessage(message.chatId, '無法查詢訂閱狀態，請稍後再試。');
		}
	}

	/**
	 * 處理 /help 指令
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleHelpCommand(message: ParsedMessage): Promise<void> {
		const isGroup = this.groupUtils.isGroupChat(message.chatType);

		if (isGroup) {
			// 群組環境的幫助訊息
			await this.sendGroupHelpMessage(message);
		} else {
			// 私人聊天的幫助訊息
			await this.sendPrivateHelpMessage(message);
		}
	}

	/**
	 * 發送私人聊天的幫助訊息
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async sendPrivateHelpMessage(message: ParsedMessage): Promise<void> {
		const helpMessage =
			`📖 新聞推播機器人使用指南\n\n` +
			`🤖 歡迎使用新聞推播服務！我可以為您提供即時新聞推播。\n\n` +
			`📋 基本指令：\n` +
			`/start - 開始使用，查看歡迎訊息\n` +
			`/subscribe - 訂閱新聞推播服務\n` +
			`/unsubscribe - 取消新聞推播訂閱\n` +
			`/status - 查看您的訂閱狀態\n` +
			`/help - 顯示此使用說明\n\n` +
			`🔤 快速關鍵字：\n` +
			`您也可以直接發送以下關鍵字：\n` +
			`• 「訂閱」或「subscribe」- 快速訂閱\n` +
			`• 「退訂」或「unsubscribe」- 快速退訂\n` +
			`• 「狀態」或「status」- 查看狀態\n\n` +
			`⚠️ 重要提醒：\n` +
			`• 訂閱後需點擊確認連結才會正式生效\n` +
			`• 確認連結將在 10 分鐘後自動過期\n` +
			`• 您可以隨時取消訂閱，無需任何費用\n` +
			`• 推播時間為每小時整點（如有新聞）\n\n` +
			`💡 使用技巧：\n` +
			`• 建議先使用 /status 檢查訂閱狀態\n` +
			`• 如遇問題，請重新執行相關指令\n` +
			`• 確認郵件可能會在垃圾郵件資料夾中`;

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{ text: '🔔 立即訂閱', callback_data: 'subscribe' },
					{ text: '📊 查看狀態', callback_data: 'status' },
				],
				[{ text: '❌ 關閉說明', callback_data: 'close_help' }],
			],
		};

		await this.telegramApi.sendInteractiveMessage(message.chatId.toString(), helpMessage, keyboard);
	}

	/**
	 * 發送群組聊天的幫助訊息
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async sendGroupHelpMessage(message: ParsedMessage): Promise<void> {
		const isAdmin = await this.groupUtils.checkAdminPermission(message.chatId, message.userId);

		let helpMessage =
			`📖 群組新聞推播機器人使用指南\n\n` +
			`🤖 我是新聞推播機器人，可以為群組提供新聞推播服務！\n\n` +
			`👥 一般成員指令：\n` +
			`/start@this_news_bot - 查看歡迎訊息\n` +
			`/help@this_news_bot - 顯示此說明（就是現在這個）\n\n` +
			`📱 個人訂閱管理：\n` +
			`• 請直接私訊機器人進行訂閱管理\n` +
			`• 在群組中無法進行個人訂閱操作\n` +
			`• 點擊機器人頭像 → 「發送訊息」開始使用\n\n`;

		if (isAdmin) {
			helpMessage +=
				`👑 管理員專用指令：\n` +
				`/groupsettings@this_news_bot - 開啟群組管理面板\n` +
				`/groupinfo@this_news_bot - 檢視群組資訊與狀態\n\n` +
				`🛠️ 管理員功能：\n` +
				`• 群組訂閱管理 - 為整個群組訂閱新聞\n` +
				`• 推播設定調整 - 修改推播頻率和類型\n` +
				`• 成員權限管理 - 檢視群組成員狀態\n` +
				`• 統計資訊查看 - 群組使用統計\n\n` +
				`💡 管理員提示：\n` +
				`• 需要機器人管理員權限才能使用部分功能\n` +
				`• 建議為機器人開啟「發送訊息」權限\n` +
				`• 群組設定變更將影響所有成員\n\n`;
		} else {
			helpMessage += `🔒 群組管理功能：\n` + `• 僅限群組管理員使用\n` + `• 如需管理群組推播設定，請聯絡管理員\n\n`;
		}

		helpMessage +=
			`⚠️ 群組使用注意事項：\n` +
			`• 使用指令時請加上 @this_news_bot\n` +
			`• 避免頻繁使用指令，以免影響群組討論\n` +
			`• 個人訂閱請使用私訊功能\n` +
			`• 群組推播設定僅影響群組本身\n\n` +
			`📞 需要協助？\n` +
			`• 私訊機器人獲得更詳細的個人服務\n` +
			`• 群組管理問題請聯絡群組管理員\n` +
			`• 技術問題可查看機器人狀態`;

		// 群組中使用簡化的鍵盤，避免干擾群組討論
		const baseButtons = [[{ text: '💬 私訊機器人', url: 'https://t.me/this_news_bot' }]];

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: isAdmin ? [...baseButtons, [{ text: '⚙️ 群組管理', callback_data: 'group_settings' }]] : baseButtons,
		};

		await this.telegramApi.sendInteractiveMessage(message.chatId.toString(), helpMessage, keyboard);
	}

	/**
	 * 處理 /confirm 指令
	 * @param message 解析後的訊息物件
	 * @param args 指令參數
	 * @returns Promise<void>
	 */
	private async handleConfirmCommand(message: ParsedMessage, args: string[]): Promise<void> {
		if (args.length === 0) {
			await this.sendErrorMessage(message.chatId, '請提供確認 Token。格式：/confirm <token>');
			return;
		}

		const token = args[0];
		console.log(`處理確認指令，Token: ${token.substring(0, 8)}...`);

		try {
			const confirmResult = await this.confirmSubscription(token);

			if (confirmResult.success) {
				const message_text =
					`🎉 訂閱確認成功！\n\n` +
					`✅ 您已成功訂閱新聞推播服務\n` +
					`📰 將開始收到最新新聞推播\n\n` +
					`💡 輸入 /status 可查看詳細狀態\n` +
					`❌ 如需退訂請輸入 /unsubscribe`;

				const keyboard: InlineKeyboardMarkup = {
					inline_keyboard: [[{ text: '📊 查看狀態', callback_data: 'status' }]],
				};

				await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
			} else {
				await this.sendErrorMessage(message.chatId, confirmResult.error || '確認失敗');
			}
		} catch (error) {
			console.error('處理確認指令失敗:', error);
			await this.sendErrorMessage(message.chatId, '無法處理確認請求，請稍後再試。');
		}
	}

	/**
	 * 處理未知指令
	 * @param message 解析後的訊息物件
	 * @param command 未知指令名稱
	 * @returns Promise<void>
	 */
	private async handleUnknownCommand(message: ParsedMessage, command: string): Promise<void> {
		const message_text = `❓ 不認識的指令：/${command}\n\n` + `💡 輸入 /help 查看可用指令\n` + `🔔 或直接點擊下方按鈕開始使用`;

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: [
				[
					{ text: '❓ 查看幫助', callback_data: 'help' },
					{ text: '🔔 開始訂閱', callback_data: 'subscribe' },
				],
			],
		};

		await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
	}

	/**
	 * 處理未知訊息（私聊中的非指令訊息）
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleUnknownMessage(message: ParsedMessage): Promise<void> {
		const message_text =
			`🤔 我不太理解您的訊息\n\n` +
			`💡 您可以：\n` +
			`• 輸入 /help 查看使用說明\n` +
			`• 輸入 /subscribe 訂閱新聞\n` +
			`• 使用「訂閱」、「狀態」等關鍵字`;

		const keyboard: InlineKeyboardMarkup = {
			inline_keyboard: [[{ text: '❓ 查看幫助', callback_data: 'help' }]],
		};

		await this.telegramApi.sendInteractiveMessage(message.chatId, message_text, keyboard);
	}

	/**
	 * 發送錯誤訊息
	 * @param chatId 聊天 ID
	 * @param errorMessage 錯誤訊息
	 * @returns Promise<void>
	 */
	private async sendErrorMessage(chatId: number, errorMessage: string): Promise<void> {
		try {
			const message_text = `❌ ${errorMessage}\n\n💡 如需幫助請輸入 /help`;
			await this.telegramApi.sendInteractiveMessage(chatId, message_text);
		} catch (error) {
			console.error('發送錯誤訊息失敗:', error);
		}
	}

	/**
	 * 檢查關鍵字是否存在於文字中
	 * @param text 要檢查的文字
	 * @param keywords 關鍵字陣列
	 * @returns boolean 是否包含關鍵字
	 */
	private containsKeyword(text: string, keywords: string[]): boolean {
		return keywords.some((keyword) => text.includes(keyword));
	}

	/**
	 * 檢查用戶訂閱狀態（簡化版）
	 * @param chatId 聊天 ID
	 * @returns Promise<{subscribed: boolean, confirmed: boolean}>
	 */
	private async checkSubscriptionStatus(chatId: string): Promise<{ subscribed: boolean; confirmed: boolean }> {
		try {
			// 呼叫內部 API 檢查訂閱狀態
			const response = await fetch(`https://${this.getWorkerDomain()}/subscriptions/${chatId}/status`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				return {
					subscribed: data.ok && data.chat_id === chatId,
					confirmed: data.confirmed || false,
				};
			} else {
				console.warn(`訂閱狀態查詢失敗: ${response.status}`);
				return { subscribed: false, confirmed: false };
			}
		} catch (error) {
			console.error('檢查訂閱狀態時發生錯誤:', error);
			return { subscribed: false, confirmed: false };
		}
	}

	/**
	 * 取得詳細訂閱狀態
	 * @param chatId 聊天 ID
	 * @returns Promise<any> 詳細狀態資訊
	 */
	private async getDetailedSubscriptionStatus(chatId: string): Promise<any> {
		try {
			// 呼叫內部 API 取得詳細狀態
			const response = await fetch(`https://${this.getWorkerDomain()}/subscriptions/${chatId}/status`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				if (data.ok) {
					return {
						subscribed: true,
						confirmed: data.confirmed || false,
						subscribe_ts: data.subscribe_ts,
						confirm_ts: data.confirm_ts,
						token_expired: data.token_expired || false,
					};
				}
			}

			return { subscribed: false, confirmed: false, token_expired: false };
		} catch (error) {
			console.error('取得詳細訂閱狀態時發生錯誤:', error);
			return { subscribed: false, confirmed: false, token_expired: false };
		}
	}

	/**
	 * 建立訂閱
	 * @param chatId 聊天 ID
	 * @returns Promise<{success: boolean, token?: string, error?: string}>
	 */
	private async createSubscription(chatId: string): Promise<{ success: boolean; token?: string; error?: string }> {
		try {
			// 呼叫內部 API 建立訂閱
			const response = await fetch(`https://${this.getWorkerDomain()}/subscriptions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ chat_id: chatId }),
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				if (data.ok) {
					return {
						success: true,
						token: data.confirm_token,
					};
				} else {
					return {
						success: false,
						error: data.error || '訂閱建立失敗',
					};
				}
			} else {
				return {
					success: false,
					error: `API 呼叫失敗: ${response.status}`,
				};
			}
		} catch (error) {
			console.error('建立訂閱時發生錯誤:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : '未知錯誤',
			};
		}
	}

	/**
	 * 刪除訂閱
	 * @param chatId 聊天 ID
	 * @returns Promise<{success: boolean, error?: string}>
	 */
	private async deleteSubscription(chatId: string): Promise<{ success: boolean; error?: string }> {
		try {
			// 呼叫內部 API 刪除訂閱
			const response = await fetch(`https://${this.getWorkerDomain()}/subscriptions/${chatId}`, {
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				if (data.ok) {
					return { success: true };
				} else {
					return {
						success: false,
						error: data.error || '退訂失敗',
					};
				}
			} else {
				return {
					success: false,
					error: `API 呼叫失敗: ${response.status}`,
				};
			}
		} catch (error) {
			console.error('刪除訂閱時發生錯誤:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : '未知錯誤',
			};
		}
	}

	/**
	 * 確認訂閱
	 * @param token 確認 Token
	 * @returns Promise<{success: boolean, error?: string}>
	 */
	private async confirmSubscription(token: string): Promise<{ success: boolean; error?: string }> {
		try {
			// 呼叫內部 API 確認訂閱
			const response = await fetch(`https://${this.getWorkerDomain()}/subscriptions/confirm?token=${token}`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (response.ok) {
				const data = (await response.json()) as any;
				if (data.ok) {
					return { success: true };
				} else {
					return {
						success: false,
						error: data.error || '確認失敗',
					};
				}
			} else {
				return {
					success: false,
					error: `API 呼叫失敗: ${response.status}`,
				};
			}
		} catch (error) {
			console.error('確認訂閱時發生錯誤:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : '未知錯誤',
			};
		}
	}

	/**
	 * 取得 Worker 域名
	 * @returns string 域名
	 */
	private getWorkerDomain(): string {
		// 這裡應該從環境變數或配置中取得實際域名
		return 'telegram-news.jlib-cf.workers.dev';
	}

	/**
	 * 處理群組設定指令
	 * @param message 解析後的訊息物件
	 * @param args 指令參數陣列
	 * @returns Promise<void>
	 */
	async handleGroupSettingsCommand(message: ParsedMessage, args: string[]): Promise<void> {
		try {
			const chatId = message.chatId;
			const userId = message.userId;
			const chatType = message.chatType;

			console.log(`處理群組設定指令，聊天類型: ${chatType}`);

			// 檢查是否為群組環境
			if (!this.groupUtils.isGroupChat(chatType)) {
				await this.telegramApi.sendMessage(chatId.toString(), '🚫 此指令僅適用於群組環境\n\n請在群組中使用此功能');
				return;
			}

			// 檢查用戶管理員權限
			const isAdmin = await this.groupUtils.checkAdminPermission(chatId, userId);
			if (!isAdmin) {
				await this.telegramApi.sendMessage(chatId.toString(), this.groupUtils.createPermissionErrorMessage('群組管理員權限'));
				return;
			}

			// 檢查機器人權限
			const botPermissions = await this.groupUtils.checkBotPermissions(chatId);
			if (!botPermissions.canSendMessages) {
				await this.telegramApi.sendMessage(chatId.toString(), this.groupUtils.createBotPermissionErrorMessage('發送訊息'));
				return;
			}

			// 建立群組設定選單
			const keyboard: InlineKeyboardMarkup = {
				inline_keyboard: [
					[
						{ text: '📰 訂閱管理', callback_data: 'group_subs' },
						{ text: '⚙️ 群組設定', callback_data: 'group_config' },
					],
					[
						{ text: '📊 群組狀態', callback_data: 'group_status' },
						{ text: '👥 成員管理', callback_data: 'group_members' },
					],
					[{ text: '❌ 關閉選單', callback_data: 'close_menu' }],
				],
			};

			await this.telegramApi.sendInteractiveMessage(
				chatId.toString(),
				'🏢 群組管理面板\n\n' +
					'歡迎使用群組管理功能！\n' +
					'請選擇要執行的操作：\n\n' +
					'📰 訂閱管理 - 管理群組的新聞訂閱\n' +
					'⚙️ 群組設定 - 修改群組推播設定\n' +
					'📊 群組狀態 - 檢視群組資訊和統計\n' +
					'👥 成員管理 - 檢視和管理群組成員',
				keyboard
			);
		} catch (error) {
			console.error('處理群組設定指令時發生錯誤:', error);
			await this.telegramApi.sendMessage(message.chatId.toString(), '❌ 群組設定指令處理失敗\n\n請稍後再試，或聯絡系統管理員');
		}
	}

	/**
	 * 處理群組資訊指令
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	async handleGroupInfoCommand(message: ParsedMessage): Promise<void> {
		try {
			const chatId = message.chatId;
			const userId = message.userId;
			const chatType = message.chatType;

			console.log(`處理群組資訊指令，聊天類型: ${chatType}`);

			// 檢查是否為群組環境
			if (!this.groupUtils.isGroupChat(chatType)) {
				await this.telegramApi.sendMessage(
					chatId.toString(),
					'ℹ️ 聊天資訊\n\n' + '類型: 私人聊天\n' + '用戶 ID: `' + userId + '`\n' + '聊天 ID: `' + chatId + '`'
				);
				return;
			}

			// 檢查用戶管理員權限
			const isAdmin = await this.groupUtils.checkAdminPermission(chatId, userId);
			if (!isAdmin) {
				await this.telegramApi.sendMessage(chatId.toString(), this.groupUtils.createPermissionErrorMessage('檢視群組資訊'));
				return;
			}

			// 檢查機器人權限
			const botPermissions = await this.groupUtils.checkBotPermissions(chatId);

			// 取得快取統計
			const cacheStats = this.groupUtils.getCacheStats();

			const infoMessage =
				'🏢 群組資訊\n\n' +
				'📊 基本資訊:\n' +
				`• 群組 ID: \`${chatId}\`\n` +
				`• 類型: ${chatType === 'supergroup' ? '超級群組' : '普通群組'}\n` +
				`• 請求用戶 ID: \`${userId}\`\n\n` +
				'🤖 機器人權限:\n' +
				`• 發送訊息: ${botPermissions.canSendMessages ? '✅' : '❌'}\n` +
				`• 刪除訊息: ${botPermissions.canDeleteMessages ? '✅' : '❌'}\n` +
				`• 置頂訊息: ${botPermissions.canPinMessages ? '✅' : '❌'}\n\n` +
				'💾 權限快取統計:\n' +
				`• 活躍快取項目: ${cacheStats.activeItems}\n` +
				`• 總快取項目: ${cacheStats.totalItems}`;

			await this.telegramApi.sendMessage(chatId.toString(), infoMessage);
		} catch (error) {
			console.error('處理群組資訊指令時發生錯誤:', error);
			await this.telegramApi.sendMessage(message.chatId.toString(), '❌ 群組資訊查詢失敗\n\n請稍後再試，或聯絡系統管理員');
		}
	}

	/**
	 * 處理群組管理子選單動作
	 * @param message 解析後的訊息物件
	 * @param action 動作類型
	 * @returns Promise<void>
	 */
	private async handleGroupManagementAction(message: ParsedMessage, action: string): Promise<void> {
		try {
			// 檢查管理員權限
			const isAdmin = await this.groupUtils.checkAdminPermission(message.chatId, message.userId);
			if (!isAdmin) {
				await this.telegramApi.sendMessage(message.chatId.toString(), this.groupUtils.createPermissionErrorMessage());
				return;
			}

			let responseMessage = '';
			let keyboard: InlineKeyboardMarkup | undefined;

			switch (action) {
				case 'group_subs':
					responseMessage =
						'📰 群組訂閱管理\n\n' +
						'管理此群組的新聞訂閱設定\n\n' +
						'🔔 功能說明：\n' +
						'• 為整個群組訂閱新聞推播\n' +
						'• 設定推播時間和頻率\n' +
						'• 管理新聞類別篩選\n\n' +
						'⚠️ 注意：群組訂閱會影響所有成員';

					keyboard = {
						inline_keyboard: [
							[
								{ text: '✅ 啟用群組訂閱', callback_data: 'group_enable_subs' },
								{ text: '❌ 停用群組訂閱', callback_data: 'group_disable_subs' },
							],
							[{ text: '🔙 返回選單', callback_data: 'group_settings' }],
						],
					};
					break;

				case 'group_config':
					responseMessage =
						'⚙️ 群組推播設定\n\n' +
						'調整群組推播相關設定\n\n' +
						'🎛️ 可設定項目：\n' +
						'• 推播時間：設定接收推播的時間\n' +
						'• 訊息格式：選擇推播訊息樣式\n' +
						'• 頻率控制：避免訊息過於頻繁\n' +
						'• 靜音時段：設定不推播的時間';

					keyboard = {
						inline_keyboard: [
							[
								{ text: '🕐 設定推播時間', callback_data: 'group_set_time' },
								{ text: '📝 訊息格式', callback_data: 'group_set_format' },
							],
							[
								{ text: '🔕 靜音設定', callback_data: 'group_set_mute' },
								{ text: '🔙 返回選單', callback_data: 'group_settings' },
							],
						],
					};
					break;

				case 'group_status':
					responseMessage =
						'📊 群組狀態資訊\n\n' +
						'🏢 群組基本資訊：\n' +
						`• 群組 ID：${message.chatId}\n` +
						`• 群組類型：${message.chatType === 'supergroup' ? '超級群組' : '群組'}\n` +
						`• 查詢時間：${new Date().toLocaleString('zh-TW')}\n\n` +
						'📈 使用統計：\n' +
						'• 本日指令執行次數：--\n' +
						'• 訂閱狀態：未訂閱\n' +
						'• 最後推播時間：無\n\n' +
						'👤 您的權限：管理員';

					keyboard = {
						inline_keyboard: [
							[
								{ text: '🔄 重新整理', callback_data: 'group_status' },
								{ text: '🔙 返回選單', callback_data: 'group_settings' },
							],
						],
					};
					break;

				case 'group_members':
					responseMessage =
						'👥 群組成員管理\n\n' +
						'管理群組成員的推播權限\n\n' +
						'🛡️ 權限管理：\n' +
						'• 查看成員推播狀態\n' +
						'• 設定個別成員權限\n' +
						'• 批量管理操作\n\n' +
						'📋 成員統計：\n' +
						'• 總成員數：--\n' +
						'• 已訂閱成員：--\n' +
						'• 活躍成員：--';

					keyboard = {
						inline_keyboard: [
							[
								{ text: '👑 管理員列表', callback_data: 'group_admin_list' },
								{ text: '👤 成員統計', callback_data: 'group_member_stats' },
							],
							[{ text: '🔙 返回選單', callback_data: 'group_settings' }],
						],
					};
					break;

				default:
					responseMessage = '❌ 未知的管理動作';
					break;
			}

			// 編輯原始訊息
			await this.editMessage(message.chatId, message.messageId, responseMessage, keyboard);
		} catch (error) {
			console.error(`處理群組管理動作 ${action} 時發生錯誤:`, error);
			await this.telegramApi.sendMessage(message.chatId.toString(), '❌ 群組管理操作失敗\n\n請稍後再試，或聯絡系統管理員');
		}
	}

	/**
	 * 刪除訊息
	 * @param chatId 聊天 ID
	 * @param messageId 訊息 ID
	 * @returns Promise<void>
	 */
	private async deleteMessage(chatId: number, messageId?: number): Promise<void> {
		if (!messageId) return;

		try {
			const url = `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/deleteMessage`;
			await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chat_id: chatId,
					message_id: messageId,
				}),
			});
		} catch (error) {
			console.error('刪除訊息失敗:', error);
		}
	}

	/**
	 * 編輯訊息
	 * @param chatId 聊天 ID
	 * @param messageId 訊息 ID
	 * @param text 新文字
	 * @param keyboard 鍵盤
	 * @returns Promise<void>
	 */
	private async editMessage(chatId: number, messageId: number | undefined, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> {
		if (!messageId) return;

		try {
			const url = `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/editMessageText`;
			const payload: any = {
				chat_id: chatId,
				message_id: messageId,
				text: text,
				parse_mode: 'HTML',
			};

			if (keyboard) {
				payload.reply_markup = keyboard;
			}

			await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(payload),
			});
		} catch (error) {
			console.error('編輯訊息失敗:', error);
		}
	}
}
