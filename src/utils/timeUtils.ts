/**
 * Telegram 新聞推播系統 - 時間處理工具
 * 繁體中文說明：處理時區轉換、時間戳計算與時間格式驗證
 */

/**
 * 將台灣時間（Asia/Taipei）轉換為 UTC 時間戳
 * @param dateString 日期字串（YYYY-MM-DD 或 ISO 8601 格式）
 * @param timeString 時間字串（HH:MM 或 HH:MM:SS，可選）
 * @returns UTC 時間戳（秒），失敗時回傳 null
 */
export function taiwanToUtc(dateString: string, timeString?: string): number | null {
	try {
		// 建立完整的日期時間字串
		let fullDateTime: string;

		if (timeString) {
			// 有提供時間，組合日期和時間
			fullDateTime = `${dateString}T${timeString}`;
		} else {
			// 沒有提供時間，預設為午夜 00:00
			fullDateTime = `${dateString}T00:00:00`;
		}

		// 在台灣時區中解析時間
		const taiwanTime = new Date(`${fullDateTime}+08:00`);

		// 驗證日期是否有效
		if (isNaN(taiwanTime.getTime())) {
			console.error(`無效的台灣時間格式: ${fullDateTime}`);
			return null;
		}

		// 轉換為 UTC 時間戳（秒）
		const utcTimestamp = Math.floor(taiwanTime.getTime() / 1000);

		console.log(`台灣時間轉換: ${fullDateTime}+08:00 -> UTC 時間戳 ${utcTimestamp}`);
		return utcTimestamp;
	} catch (error) {
		console.error('台灣時間轉 UTC 轉換失敗:', error);
		return null;
	}
}

/**
 * 解析多種發布時間格式並轉換為 UTC 時間戳
 * @param publishTime 發布時間（支援多種格式）
 * @returns UTC 時間戳（秒），失敗時回傳 null
 */
export function parsePublishTime(publishTime: string): number | null {
	try {
		// 清理輸入字串
		const cleanTime = publishTime.trim();

		// 格式 1: ISO 8601 完整格式（YYYY-MM-DDTHH:MM:SSZ 或帶時區）
		if (cleanTime.includes('T') && (cleanTime.includes('Z') || cleanTime.includes('+') || cleanTime.includes('-'))) {
			const isoDate = new Date(cleanTime);
			if (!isNaN(isoDate.getTime())) {
				return Math.floor(isoDate.getTime() / 1000);
			}
		}

		// 格式 2: YYYY-MM-DD HH:MM:SS（台灣時間）
		const datetimeMatch = cleanTime.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)$/);
		if (datetimeMatch) {
			const [, dateStr, timeStr] = datetimeMatch;
			return taiwanToUtc(dateStr, timeStr);
		}

		// 格式 3: YYYY-MM-DD（台灣日期，預設午夜）
		const dateMatch = cleanTime.match(/^\d{4}-\d{2}-\d{2}$/);
		if (dateMatch) {
			return taiwanToUtc(cleanTime);
		}

		// 格式 4: Unix 時間戳（秒）
		if (/^\d{10}$/.test(cleanTime)) {
			const timestamp = parseInt(cleanTime, 10);
			if (timestamp > 0) {
				return timestamp;
			}
		}

		// 格式 5: Unix 時間戳（毫秒）
		if (/^\d{13}$/.test(cleanTime)) {
			const timestamp = parseInt(cleanTime, 10);
			if (timestamp > 0) {
				return Math.floor(timestamp / 1000);
			}
		}

		console.error(`無法解析的時間格式: ${publishTime}`);
		return null;
	} catch (error) {
		console.error('解析發布時間失敗:', error);
		return null;
	}
}

/**
 * 驗證時間戳是否在合理範圍內
 * @param timestamp UTC 時間戳（秒）
 * @returns 是否為有效時間範圍
 */
export function validateTimestamp(timestamp: number): boolean {
	const now = Math.floor(Date.now() / 1000);

	// 不允許未來時間（容許 5 分鐘誤差）
	const maxFuture = now + 300; // 5 分鐘
	if (timestamp > maxFuture) {
		console.warn(`時間戳超過允許範圍（未來時間）: ${timestamp}`);
		return false;
	}

	// 不允許太久的歷史時間（1 年前）
	const minPast = now - 365 * 24 * 60 * 60; // 1 年前
	if (timestamp < minPast) {
		console.warn(`時間戳超過允許範圍（歷史時間）: ${timestamp}`);
		return false;
	}

	return true;
}

/**
 * 格式化時間戳為可讀的台灣時間字串
 * @param timestamp UTC 時間戳（秒）
 * @returns 台灣時間字串（YYYY-MM-DD HH:MM:SS）
 */
export function formatToTaiwanTime(timestamp: number): string {
	try {
		const utcDate = new Date(timestamp * 1000);

		// 轉換為台灣時間（UTC+8）
		const taiwanDate = new Date(utcDate.getTime() + 8 * 60 * 60 * 1000);

		// 格式化為 YYYY-MM-DD HH:MM:SS
		const year = taiwanDate.getUTCFullYear();
		const month = (taiwanDate.getUTCMonth() + 1).toString().padStart(2, '0');
		const day = taiwanDate.getUTCDate().toString().padStart(2, '0');
		const hour = taiwanDate.getUTCHours().toString().padStart(2, '0');
		const minute = taiwanDate.getUTCMinutes().toString().padStart(2, '0');
		const second = taiwanDate.getUTCSeconds().toString().padStart(2, '0');

		return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
	} catch (error) {
		console.error('格式化台灣時間失敗:', error);
		return `Invalid timestamp: ${timestamp}`;
	}
}

/**
 * 取得目前的 UTC 時間戳（秒）
 * @returns 目前 UTC 時間戳
 */
export function getCurrentTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

/**
 * 計算兩個時間戳之間的差異（秒）
 * @param startTimestamp 開始時間戳
 * @param endTimestamp 結束時間戳
 * @returns 時間差異（秒）
 */
export function getTimeDifference(startTimestamp: number, endTimestamp: number): number {
	return Math.abs(endTimestamp - startTimestamp);
}
