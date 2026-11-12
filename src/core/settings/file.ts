import { parseData } from './saved.ts';

// 設定檔 `Essence Cards/設定.json`（tasks/settings-vault-file.md §1、§2）：內容與疊 legacy。不碰 Obsidian；讀寫由外層做。

/** 設定檔的位置：vault 裡的一般檔，跟著 iCloud 同步（D-199 的修法 A）。 */
export const SETTINGS_FILE = 'Essence Cards/設定.json';

/** 設定頁管的項目；學期與設定日是一項（syntax §10）。 */
const ITEMS: readonly (readonly string[])[] = [['capMinutes'], ['retention'], ['semester', 'semesterSetOn'], ['examCountdown']];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (record: Readonly<Record<string, unknown>>, key: string): boolean => Object.hasOwn(record, key);

/** data.json 裡那五個欄位（照原樣，含讀不懂的值；沒有的不列）。 */
function fieldsOf(data: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ITEMS.flat()) if (has(data, key)) picked[key] = data[key];
  return picked;
}

/**
 * 疊 legacy（§2）：設定檔的 legacy 是物件、data（讀到的 data.json）也是物件時，逐項比，不同的那幾項換成 data 的
 * （它有就換成它的值，沒有就刪掉）：舊版那台在設定檔建立之後改的項目，新版採用。其他情況照設定檔原樣。不改傳進來的物件。
 */
export function overlayLegacy(file: Readonly<Record<string, unknown>>, data: unknown): Record<string, unknown> {
  const next = { ...file };
  const legacy: unknown = file.legacy;
  if (!isObject(legacy) || !isObject(data)) return next;
  const from: Record<string, unknown> = data;
  for (const keys of ITEMS) {
    const same = keys.every(key => has(legacy, key) === has(from, key) && JSON.stringify(legacy[key]) === JSON.stringify(from[key]));
    if (same) continue;
    for (const key of keys) {
      delete next[key];
      if (has(from, key)) next[key] = from[key];
    }
  }
  return next;
}

/** 寫進設定檔的文字（§1）：legacy 換成 data 的五個欄位；data 不是物件就沿用原本的 legacy，原本也不是物件是 null。 */
export function encodeSettings(next: Readonly<Record<string, unknown>>, data: unknown): string {
  const legacy = isObject(data) ? fieldsOf(data) : isObject(next.legacy) ? next.legacy : null;
  return JSON.stringify({ ...next, legacy }, null, 2) + '\n';
}

/** 設定檔的內容：含 NUL（iCloud 還沒下載完，D-154）、不是 JSON 物件都算讀不到（undefined）。 */
export function decodeSettings(bytes: Uint8Array): Record<string, unknown> | undefined {
  if (bytes.includes(0)) return undefined;
  return parseData(bytes) ?? undefined;
}
