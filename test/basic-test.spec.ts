/**
 * 基本測試 - 驗證測試環境設置
 */
import { describe, it, expect } from 'vitest';
import { mockEnv, mockTelegramUser, generateRandomString, sleep } from './test-utils';

describe('測試環境驗證', () => {
	it('應該正確設置測試環境', () => {
		expect(mockEnv.TELEGRAM_BOT_TOKEN).toBe('test-bot-token');
		expect(mockEnv.WEBHOOK_SECRET).toBe('test-webhook-secret');
		expect(mockEnv.DB).toBeDefined();
	});

	it('應該生成隨機字符串', () => {
		const str1 = generateRandomString(10);
		const str2 = generateRandomString(10);

		expect(str1).toHaveLength(10);
		expect(str2).toHaveLength(10);
		expect(str1).not.toBe(str2);
	});

	it('應該正確模擬 Telegram 用戶數據', () => {
		expect(mockTelegramUser.id).toBe(12345678);
		expect(mockTelegramUser.first_name).toBe('測試用戶');
		expect(mockTelegramUser.username).toBe('test_user');
	});

	it('應該支援異步操作', async () => {
		const start = Date.now();
		await sleep(50);
		const end = Date.now();

		expect(end - start).toBeGreaterThanOrEqual(40);
	});
});
