/**
 * Telegram 新聞推播系統 - Telegram 服務處理程式
 * 繁體中文說明：處理 Telegram Update 解析、訊息分類和指令路由
 */

import type { Env } from '../types';
import type { TelegramUpdate, TelegramMessage, TelegramCallbackQuery } from '../handlers/telegram';
import { CommandHandler, type ParsedMessage, type CommandMatch, MessageType } from '../handlers/commands';

/**
 * Telegram 服務類別
 * 負責 Update 解析、訊息分類和指令路由處理
 */
export class TelegramService {
	private env: Env;
	private commandHandler: CommandHandler;

	constructor(env: Env) {
		this.env = env;
		this.commandHandler = new CommandHandler(env);
	}

	/**
	 * 處理 Telegram Update
	 * @param update Telegram Update 物件
	 * @returns Promise<void>
	 */
	async processUpdate(update: TelegramUpdate): Promise<void> {
		try {
			console.log('開始處理 Telegram Update:', JSON.stringify(update, null, 2));

			const parsedMessage = this.parseUpdate(update);

			if (!parsedMessage) {
				console.warn('無法解析的 Update 類型，略過處理');
				return;
			}

			console.log('解析的訊息:', JSON.stringify(parsedMessage, null, 2));

			await this.routeMessage(parsedMessage);
		} catch (error) {
			console.error('處理 Telegram Update 時發生錯誤:', error);
			throw error;
		}
	}

	/**
	 * 解析 Telegram Update
	 * @param update Telegram Update 物件
	 * @returns ParsedMessage | null 解析結果
	 */
	private parseUpdate(update: TelegramUpdate): ParsedMessage | null {
		// 處理一般訊息
		if (update.message) {
			return this.parseMessage(update.message, MessageType.TEXT_MESSAGE);
		}

		// 處理編輯訊息
		if (update.edited_message) {
			return this.parseMessage(update.edited_message, MessageType.EDITED_MESSAGE);
		}

		// 處理按鈕回調查詢
		if (update.callback_query) {
			return this.parseCallbackQuery(update.callback_query);
		}

		// 不支援的類型
		return null;
	}

	/**
	 * 解析 Telegram 訊息
	 * @param message Telegram 訊息物件
	 * @param type 訊息類型
	 * @returns ParsedMessage 解析後的訊息
	 */
	private parseMessage(message: TelegramMessage, type: MessageType): ParsedMessage {
		const isGroup = ['group', 'supergroup'].includes(message.chat.type);
		const isPrivate = message.chat.type === 'private';

		return {
			type,
			chatId: message.chat.id,
			userId: message.from?.id || 0,
			chatType: message.chat.type,
			text: message.text,
			messageId: message.message_id,
			isGroup,
			isPrivate,
		};
	}

	/**
	 * 解析按鈕回調查詢
	 * @param callbackQuery Telegram CallbackQuery 物件
	 * @returns ParsedMessage 解析後的訊息
	 */
	private parseCallbackQuery(callbackQuery: TelegramCallbackQuery): ParsedMessage {
		const message = callbackQuery.message;
		const isGroup = message ? ['group', 'supergroup'].includes(message.chat.type) : false;
		const isPrivate = message ? message.chat.type === 'private' : true;

		return {
			type: MessageType.CALLBACK_QUERY,
			chatId: message?.chat.id || 0,
			userId: callbackQuery.from.id,
			chatType: message?.chat.type || 'private',
			callbackData: callbackQuery.data,
			messageId: message?.message_id,
			isGroup,
			isPrivate,
		};
	}

	/**
	 * 路由訊息到適當的處理器
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async routeMessage(message: ParsedMessage): Promise<void> {
		try {
			console.log(`路由訊息類型: ${message.type}`);

			switch (message.type) {
				case MessageType.TEXT_MESSAGE:
					await this.handleTextMessage(message);
					break;

				case MessageType.EDITED_MESSAGE:
					console.log('略過編輯訊息處理');
					break;

				case MessageType.CALLBACK_QUERY:
					await this.handleCallbackQuery(message);
					break;

				default:
					console.warn(`未支援的訊息類型: ${message.type}`);
			}
		} catch (error) {
			console.error('路由訊息時發生錯誤:', error);
			throw error;
		}
	}

	/**
	 * 處理文字訊息
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleTextMessage(message: ParsedMessage): Promise<void> {
		if (!message.text) {
			console.log('無文字內容，略過處理');
			return;
		}

		console.log(`處理文字訊息: "${message.text}"`);

		// 檢查是否為指令
		const commandMatch = this.parseCommand(message.text);

		if (commandMatch.isCommand) {
			console.log(`檢測到指令: ${commandMatch.command}`);
			await this.commandHandler.handleCommand(message, commandMatch);
		} else {
			// 處理關鍵字或一般訊息
			console.log('處理一般文字訊息或關鍵字');
			// 對於非指令文字，可以暫時跳過或處理關鍵字
		}
	}

	/**
	 * 處理按鈕回調查詢
	 * @param message 解析後的訊息物件
	 * @returns Promise<void>
	 */
	private async handleCallbackQuery(message: ParsedMessage): Promise<void> {
		if (!message.callbackData) {
			console.warn('CallbackQuery 缺少 callback_data');
			return;
		}

		console.log(`處理按鈕回調: ${message.callbackData}`);
		await this.commandHandler.handleCallbackQuery(message);
	}

	/**
	 * 解析指令文字
	 * @param text 訊息文字
	 * @returns CommandMatch 指令匹配結果
	 */
	private parseCommand(text: string): CommandMatch {
		// 移除多餘空白
		const trimmedText = text.trim();

		// 檢查是否以 / 開頭
		if (!trimmedText.startsWith('/')) {
			return {
				command: '',
				args: [],
				isCommand: false,
			};
		}

		// 分割指令和參數
		const parts = trimmedText.split(/\s+/);
		const commandPart = parts[0];
		const args = parts.slice(1);

		// 提取指令名稱 (移除 / 和可能的 @botname)
		let command = commandPart.substring(1); // 移除 /
		const atIndex = command.indexOf('@');
		if (atIndex !== -1) {
			command = command.substring(0, atIndex); // 移除 @botname
		}

		return {
			command: command.toLowerCase(),
			args,
			isCommand: true,
		};
	}

	/**
	 * 記錄服務統計資訊
	 * @returns object 統計資訊
	 */
	getStats(): {
		supportedMessageTypes: string[];
		commandPrefix: string;
	} {
		return {
			supportedMessageTypes: ['text_message', 'callback_query', 'edited_message'],
			commandPrefix: '/',
		};
	}
}
