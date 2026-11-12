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

/** Files.watch 通知的路徑是不是設定檔（含改名的舊路徑）：大小寫與 Unicode 正規化不同也算，和 Files 同路徑排隊的比法相同。 */
export function isSettingsPath(path: string): boolean {
  const key = (text: string): string => text.normalize('NFC').toLowerCase();
  return key(path) === key(SETTINGS_FILE);
}

export interface SettingsFileIo {
  /** Files.readBytes：不存在回 null，讀不到丟錯。 */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Files.modify：原地寫，不存在時建立含上層資料夾。 */
  modify(path: string, edit: (text: string, exists: boolean) => string): Promise<void>;
  /** 舊版的 data.json（Obsidian 的 loadData）：沒有回 null，讀不到回 undefined。新版只讀不寫（§1）。 */
  loadData(): Promise<unknown>;
}
export interface SettingsFile {
  /** 給 store 的 load（§2）：設定檔疊完 legacy 的內容；設定檔不存在時照舊交出 data.json（物件、null、undefined）；設定檔讀不到回 undefined。 */
  load(): Promise<unknown>;
  /** 給 store 的 save（§2）：加上 legacy 寫進設定檔，不碰 data.json。 */
  save(data: unknown): Promise<void>;
}

/** 設定檔的讀寫（tasks/settings-vault-file.md §2）：store 的隊伍、核對、known 的規則不變，只換讀寫的對象。 */
export function createSettingsFile(io: SettingsFileIo): SettingsFile {
  /** loadData 拒絕和讀不到一樣（Obsidian 自己會吞掉錯誤，這裡只是不讓它變成程式的錯）。 */
  const data = (): Promise<unknown> => new Promise<unknown>(resolve => { resolve(io.loadData()); }).catch(() => undefined);
  return {
    async load() {
      let bytes: Uint8Array | null;
      try { bytes = await io.readBytes(SETTINGS_FILE); } catch { return undefined; }
      if (bytes === null) return data();
      const file = decodeSettings(bytes);
      if (!file) return undefined;
      return overlayLegacy(file, await data());
    },
    async save(next) {
      if (!isObject(next)) throw Error('設定要是 JSON 物件');
      const text = encodeSettings(next, await data());
      await io.modify(SETTINGS_FILE, () => text);
    },
  };
}
