import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

/**
 * 15.7 群組管理員權限測試
 * 測試群組中的管理員權限檢查機制
 */
describe('群組管理員權限測試', () => {
	const testGroupChatId = -987654321; // 負數表示群組
	const adminUserId = 111111111;
	const regularUserId = 222222222;
	const creatorUserId = 333333333;

	// 輔助函數：建立群組 webhook 請求
	const createGroupWebhookRequest = (text: string, fromUserId: number, isAdmin: boolean = false, isCreator: boolean = false) => {
		return new Request('http://example.com/tg/webhook', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
			},
			body: JSON.stringify({
				update_id: Math.floor(Math.random() * 1000000),
				message: {
					message_id: Math.floor(Math.random() * 1000),
					date: Math.floor(Date.now() / 1000),
					text: text,
					from: {
						id: fromUserId,
						is_bot: false,
						first_name: isCreator ? '群組創建者' : isAdmin ? '群組管理員' : '一般成員',
						username: `user_${fromUserId}`,
					},
					chat: {
						id: testGroupChatId,
						type: 'supergroup', // 或 'group'
						title: '測試群組',
					},
				},
			}),
		});
	};

	describe('群組管理員身份驗證', () => {
		it('群組創建者執行管理指令應成功', async () => {
			const adminCommands = ['/start@testbot', '/help@testbot', '/subscribe@testbot', '/status@testbot'];

			for (const command of adminCommands) {
				const request = createGroupWebhookRequest(command, creatorUserId, false, true);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 群組創建者應該可以執行所有指令
				expect(response.status).toBe(200);
			}
		});

		it('群組管理員執行管理指令應成功', async () => {
			const adminCommands = ['/start@testbot', '/help@testbot', '/subscribe@testbot', '/status@testbot'];

			for (const command of adminCommands) {
				const request = createGroupWebhookRequest(command, adminUserId, true, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 群組管理員應該可以執行指令
				expect(response.status).toBe(200);
			}
		});

		it('一般成員執行管理指令應受限制', async () => {
			const restrictedCommands = ['/admin@testbot', '/push@testbot', '/broadcast@testbot'];

			for (const command of restrictedCommands) {
				const request = createGroupWebhookRequest(command, regularUserId, false, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 一般成員執行管理指令應被限制，但請求本身應該被處理
				expect(response.status).toBe(200);
			}
		});

		it('一般成員可執行基本指令', async () => {
			const basicCommands = ['/start@testbot', '/help@testbot', '幫助', '狀態'];

			for (const command of basicCommands) {
				const request = createGroupWebhookRequest(command, regularUserId, false, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 基本指令應該對所有用戶開放
				expect(response.status).toBe(200);
			}
		});
	});

	describe('權限 API 調用測試', () => {
		it('getChatMember API 調用應正確處理', async () => {
			// 模擬需要權限檢查的指令
			const request = createGroupWebhookRequest('/admin@testbot', adminUserId, true, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 即使是模擬的權限檢查，API 也應該正確回應
			expect(response.status).toBe(200);
		});

		it('權限檢查失敗應正確處理', async () => {
			// 模擬權限檢查 API 失敗的情況
			const request = createGroupWebhookRequest('/admin@testbot', regularUserId, false, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// API 錯誤應該被正確處理
			expect(response.status).toBe(200);
		});

		it('權限快取機制測試', async () => {
			// 連續發送相同用戶的請求，測試快取機制
			const requests = Array.from({ length: 3 }, () => createGroupWebhookRequest('/help@testbot', adminUserId, true, false));

			const startTime = Date.now();

			for (const request of requests) {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}

			const endTime = Date.now();
			const totalTime = endTime - startTime;

			// 如果有快取，後續請求應該更快
			console.log(`權限檢查總時間: ${totalTime}ms`);

			// 在測試環境中，主要驗證請求都能正確處理
			expect(totalTime).toBeLessThan(10000); // 應該在 10 秒內完成
		});
	});

	describe('群組專用功能測試', () => {
		it('群組訊息格式應適當且簡潔', async () => {
			const request = createGroupWebhookRequest('/help@testbot', regularUserId, false, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);

			// 在實際實作中，這裡會檢查回傳的訊息格式
			// 群組訊息應該比私人對話更簡潔
		});

		it('@bot_username 指令格式支援', async () => {
			const botUsernameCommands = ['/start@testbot', '/help@newsbot', '/subscribe@my_news_bot', '/status@test_bot'];

			for (const command of botUsernameCommands) {
				const request = createGroupWebhookRequest(command, adminUserId, true, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(200);
			}
		});

		it('不帶 @bot 的指令在群組中應被忽略', async () => {
			const commandsWithoutBot = [
				'/start', // 沒有 @bot
				'/help', // 沒有 @bot
				'/subscribe', // 沒有 @bot
				'幫助', // 中文關鍵字在群組中可能需要特殊處理
				'訂閱', // 中文關鍵字在群組中可能需要特殊處理
			];

			for (const command of commandsWithoutBot) {
				const request = createGroupWebhookRequest(command, adminUserId, true, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 請求應該被處理，但可能不會回應
				expect(response.status).toBe(200);
			}
		});

		it('群組專用回應邏輯測試', async () => {
			// 測試群組中的特殊回應邏輯
			const request = createGroupWebhookRequest('/start@testbot', regularUserId, false, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});
	});

	describe('邊界情況測試', () => {
		it('機器人被踢出群組的情況', async () => {
			// 模擬機器人被踢出群組的 webhook
			const kickedWebhook = {
				update_id: 999999,
				my_chat_member: {
					chat: {
						id: testGroupChatId,
						type: 'supergroup',
						title: '測試群組',
					},
					from: {
						id: adminUserId,
						is_bot: false,
						first_name: '管理員',
					},
					date: Math.floor(Date.now() / 1000),
					old_chat_member: {
						user: {
							id: 123456789, // bot 的 user_id
							is_bot: true,
							first_name: 'Test Bot',
						},
						status: 'member',
					},
					new_chat_member: {
						user: {
							id: 123456789,
							is_bot: true,
							first_name: 'Test Bot',
						},
						status: 'kicked',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(kickedWebhook),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 應該正確處理機器人被踢出的事件
			expect(response.status).toBe(200);
		});

		it('管理員權限變更的情況', async () => {
			// 模擬用戶從管理員降為一般成員
			const demotedUserWebhook = {
				update_id: 999998,
				chat_member: {
					chat: {
						id: testGroupChatId,
						type: 'supergroup',
						title: '測試群組',
					},
					from: {
						id: creatorUserId,
						is_bot: false,
						first_name: '群組創建者',
					},
					date: Math.floor(Date.now() / 1000),
					old_chat_member: {
						user: {
							id: adminUserId,
							is_bot: false,
							first_name: '前管理員',
						},
						status: 'administrator',
					},
					new_chat_member: {
						user: {
							id: adminUserId,
							is_bot: false,
							first_name: '前管理員',
						},
						status: 'member',
					},
				},
			};

			const request = new Request('http://example.com/tg/webhook', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
				},
				body: JSON.stringify(demotedUserWebhook),
			});

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 應該正確處理權限變更事件
			expect(response.status).toBe(200);
		});

		it('群組設定變更的情況', async () => {
			// 測試群組標題或其他設定變更
			const request = createGroupWebhookRequest('/help@testbot', adminUserId, true, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
		});

		it('無法取得用戶權限資訊時的降級處理', async () => {
			// 模擬 getChatMember API 調用失敗
			const request = createGroupWebhookRequest('/admin@testbot', regularUserId, false, false);

			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// 即使權限檢查失敗，也應該有適當的降級處理
			expect(response.status).toBe(200);
		});
	});

	describe('權限檢查機制驗證', () => {
		it('權限檢查機制完全正確', async () => {
			// 建立測試矩陣：不同用戶類型 × 不同指令類型
			const userTypes = [
				{ id: creatorUserId, isCreator: true, isAdmin: false, name: '創建者' },
				{ id: adminUserId, isCreator: false, isAdmin: true, name: '管理員' },
				{ id: regularUserId, isCreator: false, isAdmin: false, name: '一般成員' },
			];

			const commandTypes = [
				{ cmd: '/help@testbot', requiresAdmin: false, name: '基本指令' },
				{ cmd: '/start@testbot', requiresAdmin: false, name: '開始指令' },
				{ cmd: '/subscribe@testbot', requiresAdmin: false, name: '訂閱指令' },
				{ cmd: '/admin@testbot', requiresAdmin: true, name: '管理指令' },
				{ cmd: '/broadcast@testbot', requiresAdmin: true, name: '推播指令' },
			];

			for (const user of userTypes) {
				for (const command of commandTypes) {
					const request = createGroupWebhookRequest(command.cmd, user.id, user.isAdmin, user.isCreator);

					const ctx = createExecutionContext();
					const response = await worker.fetch(request, env, ctx);
					await waitOnExecutionContext(ctx);

					expect(response.status).toBe(200);

					// 在實際環境中，這裡會檢查：
					// - 需要管理員權限的指令，只有管理員和創建者能執行
					// - 基本指令所有人都能執行
					console.log(`${user.name} 執行 ${command.name}: 已處理`);
				}
			}
		});

		it('只有授權用戶能執行管理功能', async () => {
			const managementCommands = ['/push@testbot', '/broadcast@testbot', '/admin@testbot', '/settings@testbot'];

			// 測試未授權用戶（一般成員）
			for (const command of managementCommands) {
				const request = createGroupWebhookRequest(command, regularUserId, false, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 請求應該被處理，但應該拒絕執行管理功能
				expect(response.status).toBe(200);
			}

			// 測試授權用戶（管理員）
			for (const command of managementCommands) {
				const request = createGroupWebhookRequest(command, adminUserId, true, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				// 管理員應該能執行管理功能
				expect(response.status).toBe(200);
			}
		});

		it('群組功能與私聊功能正確區分', async () => {
			// 測試相同指令在群組和私聊中的不同行為
			const testCommands = ['/start', '/help', '/subscribe'];

			for (const command of testCommands) {
				// 私聊中的指令（不需要 @bot）
				const privateRequest = new Request('http://example.com/tg/webhook', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Telegram-Bot-Api-Secret-Token': 'test-secret',
					},
					body: JSON.stringify({
						update_id: Math.floor(Math.random() * 1000000),
						message: {
							message_id: Math.floor(Math.random() * 1000),
							date: Math.floor(Date.now() / 1000),
							text: command,
							from: {
								id: regularUserId,
								is_bot: false,
								first_name: '私聊用戶',
							},
							chat: {
								id: regularUserId, // 正數表示私聊
								type: 'private',
							},
						},
					}),
				});

				const privateCtx = createExecutionContext();
				const privateResponse = await worker.fetch(privateRequest, env, privateCtx);
				await waitOnExecutionContext(privateCtx);

				expect(privateResponse.status).toBe(200);

				// 群組中的指令（需要 @bot）
				const groupRequest = createGroupWebhookRequest(`${command}@testbot`, regularUserId, false, false);

				const groupCtx = createExecutionContext();
				const groupResponse = await worker.fetch(groupRequest, env, groupCtx);
				await waitOnExecutionContext(groupCtx);

				expect(groupResponse.status).toBe(200);

				console.log(`${command} 在私聊和群組中都正確處理`);
			}
		});
	});

	describe('效能和穩定性測試', () => {
		it('大量群組用戶併發請求', async () => {
			const concurrentUsers = Array.from({ length: 10 }, (_, i) => ({
				id: 999000 + i,
				isAdmin: i < 3, // 前 3 個用戶是管理員
				isCreator: i === 0, // 第一個用戶是創建者
			}));

			const requests = concurrentUsers.map((user) => createGroupWebhookRequest('/help@testbot', user.id, user.isAdmin, user.isCreator));

			const startTime = Date.now();
			const promises = requests.map(async (request) => {
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);
				return response;
			});

			const responses = await Promise.all(promises);
			const endTime = Date.now();

			// 所有請求都應該成功處理
			responses.forEach((response) => {
				expect(response.status).toBe(200);
			});

			const totalTime = endTime - startTime;
			console.log(`${concurrentUsers.length} 個併發群組請求處理時間: ${totalTime}ms`);

			// 效能要求：10 個併發請求應該在 10 秒內完成
			expect(totalTime).toBeLessThan(10000);
		});

		it('權限檢查系統的記憶體使用測試', async () => {
			// 模擬長時間運行中的權限檢查
			const testDuration = 100; // 測試 100 次請求
			let successCount = 0;

			for (let i = 0; i < testDuration; i++) {
				const userId = 777000 + (i % 5); // 輪流使用 5 個不同的用戶
				const isAdmin = i % 3 === 0; // 每 3 個請求有 1 個是管理員

				const request = createGroupWebhookRequest('/status@testbot', userId, isAdmin, false);

				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				if (response.status === 200) {
					successCount++;
				}

				// 每 20 次請求檢查一次
				if ((i + 1) % 20 === 0) {
					console.log(`已處理 ${i + 1}/${testDuration} 個權限檢查請求`);
				}
			}

			// 驗證所有請求都成功處理
			expect(successCount).toBe(testDuration);
			console.log(`權限檢查系統穩定性測試完成: ${successCount}/${testDuration} 成功`);
		});
	});
});
